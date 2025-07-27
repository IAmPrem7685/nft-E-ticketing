// src/services/solanaService.js
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Metaplex, keypairIdentity, irysStorage, toMetaplexFile, toBigNumber } from '@metaplex-foundation/js'; // Added toBigNumber import
import bs58 from 'bs58';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

let connection;
let metaplex;
let adminKeypair;

/**
 * Initializes the Solana connection, Metaplex instance, and admin keypair.
 */
export function initializeSolana() {
    try {
        const rpcUrl = process.env.SOLANA_RPC_URL;
        const wsUrl = process.env.SOLANA_WS_URL; // Get WebSocket URL as well
        const adminPrivateKey = process.env.SOLANA_ADMIN_PRIVATE_KEY?.trim();

        if (!rpcUrl) {
            throw new Error('SOLANA_RPC_URL is not defined in .env');
        }
        if (!wsUrl) {
            throw new Error('SOLANA_WS_URL is not defined in .env');
        }
        if (!adminPrivateKey) {
            throw new Error('SOLANA_ADMIN_PRIVATE_KEY is not defined in .env. This is needed for admin operations like deploying Collection NFTs.');
        }

        const decodedPrivateKey = bs58.decode(adminPrivateKey);
        adminKeypair = Keypair.fromSecretKey(decodedPrivateKey);

        connection = new Connection(rpcUrl, 'confirmed'); // Keep 'confirmed' for now

        metaplex = Metaplex.make(connection)
            .use(keypairIdentity(adminKeypair)) // Use admin keypair for signing
            // Explicitly configure irysStorage for Devnet
            .use(irysStorage({
                address: "https://devnet.irys.xyz", // Irys Devnet bundler address
                providerUrl: rpcUrl, // Your Helius RPC URL
                timeout: 60000, // Increase timeout to 60 seconds
            }));

        console.log('Solana connection and Metaplex initialized.');
        console.log('Admin Wallet Public Key:', adminKeypair.publicKey.toBase58());
        console.log('Using Solana RPC URL:', rpcUrl);
        console.log('Using Solana WS URL:', wsUrl); // Log WS URL too

    } catch (error) {
        console.error('Failed to initialize Solana services:', error);
        if (error.message.includes('Non-base58 character')) {
            console.error('HINT: The SOLANA_ADMIN_PRIVATE_KEY in your .env file might be incorrectly formatted. Ensure it is a valid Base58 encoded private key (e.g., from a keypair.json file).');
        }
        console.error('HINT: If you are consistently getting "Confirmed tx not found" errors even with sufficient SOL, consider using a more stable RPC provider like Helius (https://www.helius.xyz/) or QuickNode (https://www.quicknode.com/) for your SOLANA_RPC_URL and SOLANA_WS_URL.');
        process.exit(1);
    }
}

/**
 * Uploads metadata to Arweave/Irys.
 * In a real application, you might upload an image first, then the JSON metadata.
 * @param {object} metadata - The JSON metadata for the NFT.
 * @returns {Promise<string>} The URI of the uploaded metadata.
 */
export async function uploadMetadataToArweave(metadata) {
    try {
        console.log('Uploading metadata to Arweave/Irys...');
        // Check admin wallet balance before funding Irys
        const balance = await connection.getBalance(adminKeypair.publicKey);
        console.log(`Admin wallet balance before Irys upload: ${balance / 1_000_000_000} SOL`);

        const { uri, response } = await metaplex.nfts().uploadMetadata(metadata);
        console.log('Metadata uploaded. URI:', uri);
        // Log the Irys response if available for more debugging info
        if (response && response.id) {
            console.log(`Irys upload transaction ID: ${response.id}`);
            console.log(`Check Irys upload status: https://viewblock.io/arweave/tx/${response.id}`); // This might not always work for Irys bundler txs directly
        }
        return uri;
    } catch (error) {
        console.error('Error uploading metadata to Arweave:', error);
        throw new Error('Failed to upload metadata to Arweave.');
    }
}

/**
 * Creates a Metaplex Collection NFT for an event.
 * This NFT will serve as the parent for all ticket cNFTs.
 * @param {string} eventName - The name of the event.
 * @param {string} symbol - The symbol for the collection (e.g., EVNT).
 * @param {string} uri - The URI of the collection NFT's metadata (e.g., on Arweave).
 * @returns {Promise<PublicKey>} The mint address of the created Collection NFT.
 */
export async function createCollectionNFT(eventName, symbol, uri) {
    try {
        console.log(`Creating Collection NFT for event: ${eventName}...`);
        const { nft: collectionNft } = await metaplex.nfts().create({
            name: eventName,
            symbol: symbol,
            uri: uri,
            sellerFeeBasisPoints: 0, // Collection NFTs typically don't have royalties
            isMutable: true, // Can be updated later if needed
            isCollection: true, // Mark as a collection NFT
            updateAuthority: adminKeypair,
        }, { commitment: 'finalized' });

        console.log('Collection NFT created:', collectionNft.address.toBase58());
        return collectionNft.address;
    } catch (error) {
        console.error('Error creating Collection NFT:', error);
        throw new Error('Failed to create Collection NFT.');
    }
}

/**
 * Deploys a Metaplex Candy Machine V3 for an event.
 * NOTE: This is a simplified representation. Full Candy Machine deployment
 * often involves more complex configuration and can be done via CLI or a dedicated script.
 * This function primarily sets up the parameters.
 * @param {PublicKey} collectionMintAddress - The mint address of the Collection NFT.
 * @param {number} priceInSol - The price per ticket in SOL.
 * @param {number} numberOfTickets - Total number of tickets to be minted.
 * @returns {Promise<PublicKey>} The Candy Machine ID.
 */
export async function deployCandyMachine(collectionMintAddress, priceInSol, numberOfTickets) {
    try {
        console.log(`Deploying Candy Machine for collection: ${collectionMintAddress.toBase58()}...`);

        // Corrected startDate guard: use toBigNumber with Unix timestamp in seconds
        const guards = {
            solPayment: {
                amount: { basisPoints: priceInSol * 1_000_000_000, currency: { symbol: 'SOL', decimals: 9 } },
                destination: adminKeypair.publicKey, // Wallet to receive payments
            },
            startDate: { date: toBigNumber(Math.floor(new Date().getTime() / 1000)) }, // Corrected: Unix timestamp in seconds
            // Add other guards like endDate, whitelist, etc.
        };

        const { candyMachine } = await metaplex.candyMachines().create({
            itemsAvailable: numberOfTickets,
            sellerFeeBasisPoints: 500, // 5% royalty on secondary sales (adjust as needed)
            symbol: 'TICKET',
            maxSupply: numberOfTickets,
            collection: {
                address: collectionMintAddress,
                updateAuthority: adminKeypair,
            },
            // Use the `guards` property for Candy Machine V3
            guards: guards,
        }, { commitment: 'finalized' });

        console.log('Candy Machine deployed. ID:', candyMachine.address.toBase58());
        return candyMachine.address;
    } catch (error) {
        console.error('Error deploying Candy Machine:', error);
        throw new Error('Failed to deploy Candy Machine. Ensure your admin wallet has enough SOL and the collection NFT is valid.');
    }
}

/**
 * Verifies the ownership of a cNFT on the Solana blockchain.
 * This function uses the Bubblegum program to get details for compressed NFTs.
 * @param {string} nftMintAddress - The mint address of the cNFT.
 * @param {string} expectedOwnerWalletAddress - The public key of the wallet expected to own the NFT.
 * @returns {Promise<boolean>} True if the NFT exists and is owned by the expected wallet, false otherwise.
 */
export async function verifyTicketOwnershipOnChain(nftMintAddress, expectedOwnerWalletAddress) {
    try {
        console.log(`Verifying ownership for NFT: ${nftMintAddress} by ${expectedOwnerWalletAddress}...`);
        const nftPublicKey = new PublicKey(nftMintAddress);
        const ownerPublicKey = new PublicKey(expectedOwnerWalletAddress);

        // Fetch the asset using Metaplex's Bubblegum (for cNFTs)
        const asset = await metaplex.nfts().findNftByMint({ mintAddress: nftPublicKey });

        if (!asset) {
            console.warn(`NFT with mint address ${nftMintAddress} not found.`);
            return false;
        }

        // For cNFTs, the owner is typically found in asset.ownership.owner
        const currentOwner = asset.ownership?.owner;

        if (!currentOwner) {
            console.warn(`Owner not found for NFT ${nftMintAddress}.`);
            return false;
        }

        if (currentOwner.toBase58() === ownerPublicKey.toBase58()) {
            console.log(`NFT ${nftMintAddress} is owned by ${expectedOwnerWalletAddress}. Verification successful.`);
            return true;
        } else {
            console.warn(`NFT ${nftMintAddress} is owned by ${currentOwner.toBase58()}, not ${expectedOwnerWalletAddress}.`);
            return false;
        }
    } catch (error) {
        console.error(`Error verifying NFT ownership for ${nftMintAddress}:`, error);
        return false; // Return false on any error during verification
    }
}

/**
 * Fetches details of a compressed NFT (cNFT) from the blockchain.
 * @param {string} nftMintAddress - The mint address of the cNFT.
 * @returns {Promise<any | null>} The NFT object or null if not found. (Changed return type to 'any' as specific types are not directly imported)
 */
export async function getCNFTDetails(nftMintAddress) {
    try {
        const nftPublicKey = new PublicKey(nftMintAddress);
        const asset = await metaplex.nfts().findNftByMint({ mintAddress: nftPublicKey });
        return asset;
    } catch (error) {
        console.error(`Error fetching cNFT details for ${nftMintAddress}:`, error);
        return null;
    }
}

// Ensure Solana services are initialized on module load
initializeSolana();
