// src/listeners/solanaListener.js
import WebSocket from 'ws';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Metaplex } from '@metaplex-foundation/js';
import dotenv from 'dotenv';
import axios from 'axios'; // For making HTTP requests to your backend

dotenv.config();

const SOLANA_WS_URL = process.env.SOLANA_WS_URL;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL;
const BACKEND_API_BASE_URL = `http://localhost:${process.env.PORT || 3000}/api`; // Your backend API URL

let connection;
let metaplex;
let ws;

/**
 * Initializes the Solana connection and Metaplex instance for the listener.
 */
function initializeListenerSolana() {
    try {
        if (!SOLANA_RPC_URL || !SOLANA_WS_URL) {
            throw new Error('SOLANA_RPC_URL or SOLANA_WS_URL is not defined in .env');
        }
        connection = new Connection(SOLANA_RPC_URL, 'confirmed');
        metaplex = Metaplex.make(connection);
        console.log('Solana listener connection initialized.');
    } catch (error) {
        console.error('Failed to initialize Solana listener services:', error);
        process.exit(1);
    }
}

/**
 * Starts the Solana WebSocket listener to monitor for relevant events.
 * This listener will focus on Candy Machine V3 mint events and potentially token transfers.
 *
 * NOTE: Monitoring all token transfers can be very high volume.
 * For production, consider using a dedicated indexer service (e.g., Helius, QuickNode)
 * or more refined filters. This is a basic example.
 */
export function startSolanaListener() {
    initializeListenerSolana();

    ws = new WebSocket(SOLANA_WS_URL);

    ws.onopen = () => {
        console.log('Solana WebSocket connection opened. Starting listener...');

        // Subscribe to logs for Candy Machine V3 program to detect mints
        // Replace with actual Candy Machine Program ID if different
        // Metaplex Candy Machine V3 Program ID (Devnet example): CndyV3LqYLyWJ6cLKc4T6UvWMfudbK3GHGzP8fEfqRt
        // You would dynamically get the Candy Machine IDs from your database
        // For demonstration, we'll assume a hardcoded or known CM ID for now.
        // In a real app, you'd fetch all active candy_machine_ids from your DB and subscribe to each.
        const candyMachineProgramId = new PublicKey('CndyV3LqYLyWJ6cLKc4T6UvWMfudbK3GHGzP8fEfqRt'); // Example Devnet CM V3 Program ID

        ws.send(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "programSubscribe",
            params: [
                candyMachineProgramId.toBase58(),
                {
                    encoding: "jsonParsed",
                    filters: [
                        { memcmp: { offset: 0, bytes: "2" } } // Filter for 'Mint' instruction (simplified, needs refinement)
                        // A more robust filter would involve parsing instruction data
                    ],
                    commitment: "confirmed"
                }
            ]
        }));

        // You might also want to subscribe to token account changes for your Collection NFTs
        // or general token transfers if you want to track secondary sales directly.
        // This can be very noisy.
        // ws.send(JSON.stringify({
        //     jsonrpc: "2.0",
        //     id: 2,
        //     method: "accountSubscribe",
        //     params: [
        //         "YOUR_COLLECTION_NFT_MINT_ADDRESS", // Replace with actual collection mint addresses
        //         {
        //             encoding: "jsonParsed",
        //             commitment: "confirmed"
        //         }
        //     ]
        // }));
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        if (data.params && data.params.result && data.params.result.value) {
            const { value } = data.params.result;

            // Handle programSubscribe (Candy Machine logs)
            if (value.logs) {
                // console.log('Received logs:', value.logs); // Uncomment to see raw logs

                // Look for specific Candy Machine V3 mint events
                const mintLog = value.logs.find(log => log.includes('Program log: Instruction: Mint'));
                if (mintLog) {
                    console.log('Detected Candy Machine Mint instruction!');
                    // This is a simplified parsing. In reality, you'd need to parse the transaction
                    // to get the exact NFT mint address and new owner.
                    // For now, we'll try to get the transaction signature and fetch details.

                    const signature = value.signature;
                    if (signature) {
                        try {
                            const transaction = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });

                            if (transaction && transaction.meta && !transaction.meta.err) {
                                // Extract relevant info from the transaction
                                let mintAddress = null;
                                let newOwner = null;
                                let candyMachineId = null;

                                // Iterate through instructions to find the Candy Machine mint
                                for (const instruction of transaction.transaction.message.instructions) {
                                    if (instruction.programId.toBase58() === candyMachineProgramId.toBase58()) {
                                        // This is a very basic way to find accounts involved.
                                        // A robust solution would parse instruction data or use a library that abstracts this.
                                        // For Candy Machine V3, the new NFT mint is often the first writable account.
                                        if (instruction.accounts && instruction.accounts.length > 0) {
                                            mintAddress = instruction.accounts[0].toBase58(); // This is often the mint
                                            // The owner might be the 3rd or 4th account, depending on instruction
                                            newOwner = instruction.accounts[3]?.toBase58(); // Example: buyer wallet
                                            candyMachineId = instruction.accounts[1]?.toBase58(); // Example: candy machine ID
                                        }
                                    }
                                }

                                if (mintAddress && newOwner && candyMachineId) {
                                    console.log(`Minted NFT: ${mintAddress} to ${newOwner} from CM: ${candyMachineId}`);

                                    // Find the event ID associated with this Candy Machine ID
                                    const { data: eventData, error: eventError } = await axios.get(`${BACKEND_API_BASE_URL}/events?candyMachineId=${candyMachineId}`); // You'll need to add a query param to your GET /events route
                                    let eventId = null;
                                    if (eventData && eventData.length > 0) {
                                        eventId = eventData[0].event_id;
                                    }

                                    if (eventId) {
                                        // Notify your backend about the successful mint
                                        await axios.post(`${BACKEND_API_BASE_URL}/tickets/mint-success`, {
                                            eventId: eventId,
                                            nftMintAddress: mintAddress,
                                            ownerWalletAddress: newOwner,
                                            solanaTransactionSignature: signature,
                                            // transactionId: (if you track pending transactions from frontend)
                                        });
                                        console.log('Backend notified of successful mint.');
                                    } else {
                                        console.warn(`Could not find event for Candy Machine ID: ${candyMachineId}. Skipping backend notification.`);
                                    }
                                } else {
                                    console.warn('Could not extract mint and owner from transaction for CM mint.');
                                }
                            }
                        } catch (txError) {
                            console.error('Error parsing transaction for mint event:', txError);
                        }
                    }
                }
            }

            // Handle accountSubscribe (for token transfers - more complex and noisy)
            // if (value.data && value.data.parsed && value.data.parsed.type === 'account') {
            //     const accountInfo = value.data.parsed.info;
            //     if (accountInfo.owner === TOKEN_PROGRAM_ID.toBase58() && accountInfo.mint) {
            //         // This is a token account. Check if its a ticket NFT and if owner changed.
            //         // This would require fetching the NFT details and comparing owners.
            //         console.log('Token account change detected:', accountInfo);
            //         // You would then call your backend's /tickets/transfer-update endpoint
            //     }
            // }
        }
    };

    ws.onclose = (event) => {
        console.log('Solana WebSocket connection closed:', event.code, event.reason);
        // Implement reconnect logic
        setTimeout(() => {
            console.log('Attempting to reconnect Solana WebSocket...');
            startSolanaListener();
        }, 5000); // Reconnect after 5 seconds
    };

    ws.onerror = (err) => {
        console.error('Solana WebSocket error:', err);
    };
}
