// src/routes/eventRoutes.js
import express from 'express';
import supabase from '../config/supabase.js';
import { createCollectionNFT, deployCandyMachine, uploadMetadataToIpfs } from '../services/solanaService.js';
import { generateQrCodeDataUrl } from '../utils/qrCodeGenerator.js';

const router = express.Router();

// Helper to generate a unique symbol for the collection NFT
const generateUniqueSymbol = (eventName) => {
    const cleanedName = eventName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return cleanedName.substring(0, 4) + Math.random().toString(36).substring(2, 6).toUpperCase();
};

/**
 * @route POST /api/events
 * @description Create a new event, deploy Collection NFT and Candy Machine.
 * @access Admin (authentication middleware would be here)
 * @body {string} name - Event name
 * @body {string} description - Event description
 * @body {string} date - Event date (e.g., "2025-12-31T19:00:00Z")
 * @body {string} time - Event time (e.g., "7:00 PM PST")
 * @body {string} venue - Event venue
 * @body {number} totalTickets - Total number of tickets for the event
 * @body {number} priceSol - Price per ticket in SOL
 * @body {number} [priceUsd] - Price per ticket in USD (optional)
 */
router.post('/', async (req, res) => {
    const { name, description, date, time, venue, totalTickets, priceSol, priceUsd } = req.body;

    if (!name || !date || !venue || !totalTickets || !priceSol) {
        return res.status(400).json({ error: 'Missing required event fields.' });
    }

    try {
        // 1. Upload Collection NFT metadata to Arweave/Irys
        const collectionSymbol = generateUniqueSymbol(name);
        const collectionMetadata = {
            name: `${name} Collection`,
            symbol: collectionSymbol,
            description: `Official NFT collection for the event: ${name}.`,
            image: "https://placehold.co/500x500/000000/FFFFFF?text=Event+Collection", // Placeholder image
            attributes: [
                { trait_type: "Type", value: "Event Collection" },
                { trait_type: "Event Name", value: name },
            ]
        };
        const collectionMetadataUri = await uploadMetadataToIpfs(collectionMetadata);

        // 2. Create Collection NFT on Solana
        const collectionMintAddress = await createCollectionNFT(name, collectionSymbol, collectionMetadataUri);

        // 3. Deploy Candy Machine V3
        const candyMachineId = await deployCandyMachine(
            collectionMintAddress,
            priceSol,
            totalTickets
        );

        // 4. Save event details to Supabase
        const { data, error } = await supabase
            .from('events')
            .insert({
                name,
                description,
                date,
                time,
                venue,
                total_tickets: totalTickets,
                available_tickets: totalTickets,
                price_sol: priceSol,
                price_usd: priceUsd,
                collection_nft_mint_address: collectionMintAddress.toBase58(), // Correctly store the collection mint address
                candy_machine_id: candyMachineId.toBase58(), // Correctly store the candy machine ID
                is_active: true
            })
            .select();

        if (error) {
            console.error('Error saving event to Supabase:', error);
            return res.status(500).json({ error: 'Failed to create event in database.', details: error.message });
        }

        res.status(201).json({
            message: 'Event created successfully!',
            event: data[0],
            collectionMintAddress: collectionMintAddress.toBase58(),
            candyMachineId: candyMachineId.toBase58()
        });

    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Internal server error during event creation.', details: error.message });
    }
});

/**
 * @route GET /api/events
 * @description Get a list of all active events, optionally filtered by Candy Machine ID.
 * @access Public
 * @query {string} [candyMachineId] - Optional: Filter events by Candy Machine ID.
 */
router.get('/', async (req, res) => {
    const { candyMachineId } = req.query; // Get candyMachineId from query parameters

    try {
        let query = supabase
            .from('events')
            .select('*')
            .eq('is_active', true)
            .order('date', { ascending: true });

        if (candyMachineId) {
            query = query.eq('candy_machine_id', candyMachineId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching events from Supabase:', error);
            return res.status(500).json({ error: 'Failed to fetch events.', details: error.message });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('Error getting events:', error);
        res.status(500).json({ error: 'Internal server error during event retrieval.', details: error.message });
    }
});

/**
 * @route GET /api/events/:eventId
 * @description Get details for a specific event.
 * @access Public
 * @param {string} eventId - The UUID of the event.
 */
router.get('/:eventId', async (req, res) => {
    const { eventId } = req.params;

    try {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('event_id', eventId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') { // No rows found
                return res.status(404).json({ error: 'Event not found.' });
            }
            console.error('Error fetching event from Supabase:', error);
            return res.status(500).json({ error: 'Failed to fetch event details.', details: error.message });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('Error getting event details:', error);
        res.status(500).json({ error: 'Internal server error during event details retrieval.', details: error.message });
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
router.post('/:eventId/purchase-initiate', async (req, res) => {
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

export default router;


