// src/routes/ticketRoutes.js
import express from 'express';
import supabase from '../config/supabase.js';
import { verifyTicketOwnershipOnChain, getCNFTDetails } from '../services/solanaService.js';
import { generateQrCodeDataUrl } from '../utils/qrCodeGenerator.js';

const router = express.Router();

/**
 * @route POST /api/tickets/verify
 * @description Verify a ticket for entry using its NFT mint address.
 * @access Public (or restricted to entry gate systems)
 * @body {string} nftMintAddress - The Solana mint address of the ticket NFT.
 * @body {string} [ownerWalletAddress] - Optional: The wallet address presented by the user (for double-checking).
 */
router.post('/verify', async (req, res) => {
    const { nftMintAddress, ownerWalletAddress } = req.body;

    if (!nftMintAddress) {
        return res.status(400).json({ error: 'NFT Mint Address is required for verification.' });
    }

    try {
        // 1. Check database for ticket status
        const { data: ticket, error: dbError } = await supabase
            .from('tickets')
            .select('*')
            .eq('nft_mint_address', nftMintAddress)
            .single();

        if (dbError) {
            if (dbError.code === 'PGRST116') { // No rows found
                console.warn(`Ticket not found in DB for mint address: ${nftMintAddress}`);
                return res.status(404).json({ error: 'Ticket not found in our records.' });
            }
            console.error('Error fetching ticket from Supabase:', dbError);
            return res.status(500).json({ error: 'Failed to retrieve ticket details from database.', details: dbError.message });
        }

        if (ticket.is_used) {
            console.warn(`Ticket ${nftMintAddress} already used.`);
            return res.status(409).json({ error: 'Ticket has already been used.' });
        }

        // 2. Verify ownership on Solana blockchain
        // If ownerWalletAddress is provided, verify against that. Otherwise, use the owner from DB (which should be current).
        const addressToVerify = ownerWalletAddress || ticket.owner_wallet_address;
        if (!addressToVerify) {
             console.error(`No owner wallet address provided or found in DB for ticket ${nftMintAddress}. Cannot verify on-chain.`);
             return res.status(500).json({ error: 'Missing owner wallet address for on-chain verification.' });
        }

        const isOwnedByExpected = await verifyTicketOwnershipOnChain(nftMintAddress, addressToVerify);

        if (!isOwnedByExpected) {
            console.warn(`On-chain ownership mismatch for ticket ${nftMintAddress}. Expected: ${addressToVerify}, Actual: Different.`);
            return res.status(403).json({ error: 'Ticket ownership verification failed on-chain. This ticket is not held by the expected wallet.' });
        }

        // 3. Mark ticket as used in the database
        const { error: updateError } = await supabase
            .from('tickets')
            .update({ is_used: true, status: 'used', updated_at: new Date().toISOString() })
            .eq('ticket_id', ticket.ticket_id);

        if (updateError) {
            console.error('Error updating ticket status in Supabase:', updateError);
            return res.status(500).json({ error: 'Failed to update ticket status after verification.', details: updateError.message });
        }

        res.status(200).json({ message: 'Ticket successfully verified and marked as used.', ticket_id: ticket.ticket_id });

    } catch (error) {
        console.error('Error during ticket verification:', error);
        res.status(500).json({ error: 'Internal server error during ticket verification.', details: error.message });
    }
});

/**
 * @route POST /api/events/:eventId/purchase-initiate
 * @description Initiates a ticket purchase process (e.g., for fiat payments or to get Candy Machine ID).
 * @access Public
 * @param {string} eventId - The UUID of the event.
 * @body {string} userWalletAddress - The user's Solana wallet address.
 * @body {string} [paymentMethod='SOL'] - 'SOL', 'USDC', 'Stripe', 'UPI'
 * @body {number} [quantity=1] - Number of tickets to purchase.
 */
router.post('/events/:eventId/purchase-initiate', async (req, res) => {
    const { eventId } = req.params;
    const { userWalletAddress, paymentMethod = 'SOL', quantity = 1 } = req.body;

    if (!userWalletAddress) {
        return res.status(400).json({ error: 'User wallet address is required.' });
    }
    if (quantity <= 0) {
        return res.status(400).json({ error: 'Quantity must be at least 1.' });
    }

    try {
        // 1. Fetch event details to get Candy Machine ID and price
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('candy_machine_id, price_sol, available_tickets')
            .eq('event_id', eventId)
            .single();

        if (eventError) {
            if (eventError.code === 'PGRST116') {
                return res.status(404).json({ error: 'Event not found.' });
            }
            console.error('Error fetching event for purchase:', eventError);
            return res.status(500).json({ error: 'Failed to retrieve event details.', details: eventError.message });
        }

        if (!event.candy_machine_id) {
            return res.status(500).json({ error: 'Candy Machine not configured for this event.' });
        }

        if (event.available_tickets < quantity) {
            return res.status(400).json({ error: `Not enough tickets available. Only ${event.available_tickets} left.` });
        }

        // 2. Create a pending transaction record
        const { data: transaction, error: transactionError } = await supabase
            .from('transactions')
            .insert({
                event_id: eventId,
                // user_id: (optional, if you have user accounts),
                payment_method: paymentMethod,
                amount: event.price_sol * quantity,
                currency: 'SOL', // Assuming SOL for now, adjust based on paymentMethod
                status: 'pending'
            })
            .select();

        if (transactionError) {
            console.error('Error creating pending transaction:', transactionError);
            return res.status(500).json({ error: 'Failed to create pending transaction.', details: transactionError.message });
        }

        // 3. Respond with Candy Machine ID and transaction details for frontend to proceed
        // The frontend will then use this information to interact directly with the Candy Machine
        // via the user's wallet.
        res.status(200).json({
            message: 'Purchase initiated. Please complete the minting process from your wallet.',
            candyMachineId: event.candy_machine_id,
            priceSol: event.price_sol,
            quantity: quantity,
            transactionId: transaction[0].transaction_id,
            // For fiat payments, you'd return a client secret here
            // fiatPaymentIntent: await createFiatPaymentIntent(...)
        });

    } catch (error) {
        console.error('Error initiating purchase:', error);
        res.status(500).json({ error: 'Internal server error during purchase initiation.', details: error.message });
    }
});


/**
 * @route POST /api/tickets/mint-success
 * @description Endpoint for Solana listener or frontend to notify backend of successful mint.
 * @access Internal/Webhook (secure this with API key or signature verification)
 * @body {string} eventId - UUID of the event.
 * @body {string} nftMintAddress - The mint address of the newly minted NFT.
 * @body {string} ownerWalletAddress - The public key of the wallet that received the NFT.
 * @body {string} solanaTransactionSignature - The signature of the mint transaction.
 * @body {string} [transactionId] - Optional: The ID of the pending transaction if initiated via backend.
 */
router.post('/mint-success', async (req, res) => {
    const { eventId, nftMintAddress, ownerWalletAddress, solanaTransactionSignature, transactionId } = req.body;

    if (!eventId || !nftMintAddress || !ownerWalletAddress || !solanaTransactionSignature) {
        return res.status(400).json({ error: 'Missing required fields for mint success notification.' });
    }

    try {
        // Check if ticket already exists (to prevent double processing)
        const { data: existingTicket, error: checkError } = await supabase
            .from('tickets')
            .select('ticket_id')
            .eq('nft_mint_address', nftMintAddress)
            .single();

        if (existingTicket) {
            console.warn(`Ticket with mint address ${nftMintAddress} already exists. Skipping.`);
            return res.status(200).json({ message: 'Ticket already processed.' });
        }

        // Generate QR code data URL for the NFT mint address
        const qrCodeData = nftMintAddress; // Or a more complex unique identifier
        const qrCodeUrl = await generateQrCodeDataUrl(qrCodeData); // In a real app, you might store this image on cloud storage

        // Fetch event details to get seat info logic (if applicable)
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('name, total_tickets, available_tickets')
            .eq('event_id', eventId)
            .single();

        if (eventError || !event) {
            console.error('Event not found for mint success processing:', eventId);
            return res.status(404).json({ error: 'Event not found for ticket processing.' });
        }

        // Determine seat info (simplified: could be sequential or based on event logic)
        const seatInfo = `Ticket #${event.total_tickets - event.available_tickets + 1}`; // Simple incrementing logic

        // Insert new ticket into database
        const { data: newTicket, error: insertError } = await supabase
            .from('tickets')
            .insert({
                event_id: eventId,
                nft_mint_address: nftMintAddress,
                owner_wallet_address: ownerWalletAddress,
                seat_info: seatInfo,
                status: 'purchased',
                original_purchase_date: new Date().toISOString(),
                original_purchaser_wallet_address: ownerWalletAddress,
                qr_code_data: qrCodeData,
                qr_code_url: qrCodeUrl,
                // metadata_uri: (this would come from the Candy Machine's item data)
            })
            .select();

        if (insertError) {
            console.error('Error inserting new ticket after mint success:', insertError);
            return res.status(500).json({ error: 'Failed to record new ticket.', details: insertError.message });
        }

        // Update available tickets count for the event
        const { error: updateEventError } = await supabase
            .from('events')
            .update({ available_tickets: event.available_tickets - 1 })
            .eq('event_id', eventId);

        if (updateEventError) {
            console.error('Error updating available tickets count:', updateEventError);
            // This is a non-critical error for the user, but important for data consistency
        }

        // Update transaction status if a transactionId was provided
        if (transactionId) {
            const { error: updateTransactionError } = await supabase
                .from('transactions')
                .update({
                    status: 'successful',
                    solana_transaction_signature: solanaTransactionSignature,
                    ticket_id: newTicket[0].ticket_id
                })
                .eq('transaction_id', transactionId);

            if (updateTransactionError) {
                console.error('Error updating transaction status:', updateTransactionError);
            }
        }

        res.status(200).json({ message: 'Ticket successfully recorded and event updated.', ticket: newTicket[0] });

    } catch (error) {
        console.error('Error processing mint success notification:', error);
        res.status(500).json({ error: 'Internal server error processing mint success.', details: error.message });
    }
});

/**
 * @route POST /api/tickets/transfer-update
 * @description Endpoint for Solana listener to notify backend of ticket transfers.
 * @access Internal/Webhook (secure this with API key or signature verification)
 * @body {string} nftMintAddress - The mint address of the transferred NFT.
 * @body {string} newOwnerWalletAddress - The public key of the new owner's wallet.
 * @body {string} solanaTransactionSignature - The signature of the transfer transaction.
 */
router.post('/transfer-update', async (req, res) => {
    const { nftMintAddress, newOwnerWalletAddress, solanaTransactionSignature } = req.body;

    if (!nftMintAddress || !newOwnerWalletAddress || !solanaTransactionSignature) {
        return res.status(400).json({ error: 'Missing required fields for transfer update notification.' });
    }

    try {
        const { data: ticket, error: dbError } = await supabase
            .from('tickets')
            .select('ticket_id, owner_wallet_address')
            .eq('nft_mint_address', nftMintAddress)
            .single();

        if (dbError) {
            if (dbError.code === 'PGRST116') {
                console.warn(`Ticket not found in DB for mint address: ${nftMintAddress}. Cannot update transfer.`);
                return res.status(404).json({ error: 'Ticket not found in our records.' });
            }
            console.error('Error fetching ticket for transfer update:', dbError);
            return res.status(500).json({ error: 'Failed to retrieve ticket details for transfer.', details: dbError.message });
        }

        if (ticket.owner_wallet_address === newOwnerWalletAddress) {
            console.warn(`Owner for ${nftMintAddress} is already ${newOwnerWalletAddress}. Skipping update.`);
            return res.status(200).json({ message: 'Ticket owner already up-to-date.' });
        }

        const { error: updateError } = await supabase
            .from('tickets')
            .update({
                owner_wallet_address: newOwnerWalletAddress,
                status: 'transferred',
                last_transfer_date: new Date().toISOString()
            })
            .eq('ticket_id', ticket.ticket_id);

        if (updateError) {
            console.error('Error updating ticket owner in Supabase:', updateError);
            return res.status(500).json({ error: 'Failed to update ticket owner.', details: updateError.message });
        }

        res.status(200).json({ message: 'Ticket owner updated successfully.', ticket_id: ticket.ticket_id });

    } catch (error) {
        console.error('Error processing transfer update:', error);
        res.status(500).json({ error: 'Internal server error processing transfer update.', details: error.message });
    }
});

export default router;
