// src/services/solanaService.js
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Metaplex, keypairIdentity, toBigNumber } from '@metaplex-foundation/js';
import bs58 from 'bs58';
import { PinataSDK } from "pinata"; 
import { Blob } from "buffer"; 
import dotenv from 'dotenv';

dotenv.config();

let connection;
let metaplex;
let adminKeypair;
let pinata;

/**
 * Initializes the Solana connection, Metaplex instance, and Pinata SDK.
 */
export function initializeSolana() {
    try {
        const rpcUrl = process.env.SOLANA_RPC_URL;
        const wsUrl = process.env.SOLANA_WS_URL;
        const adminPrivateKey = process.env.SOLANA_ADMIN_PRIVATE_KEY?.trim();
        const pinataJwt = process.env.PINATA_JWT;

        if (!rpcUrl) throw new Error('SOLANA_RPC_URL is not defined in .env');
        if (!wsUrl) throw new Error('SOLANA_WS_URL is not defined in .env');
        if (!adminPrivateKey) throw new Error('SOLANA_ADMIN_PRIVATE_KEY is not defined in .env.');
        if (!pinataJwt) throw new Error('PINATA_JWT is not defined in .env. Please get it from your Pinata account.');

        const decodedPrivateKey = bs58.decode(adminPrivateKey);
        adminKeypair = Keypair.fromSecretKey(decodedPrivateKey);

        connection = new Connection(rpcUrl, 'confirmed');

        metaplex = Metaplex.make(connection)
            .use(keypairIdentity(adminKeypair));

        pinata = new PinataSDK({
          pinataJwt: pinataJwt,
          pinataGateway: process.env.GATEWAY_URL || "gateway.pinata.cloud"
        });

        console.log('Solana connection, Metaplex, and Pinata SDK initialized.');
        console.log('Admin Wallet Public Key:', adminKeypair.publicKey.toBase58());

    } catch (error) {
        console.error('Failed to initialize services:', error);
        process.exit(1);
    }
}

/**
 * Uploads metadata to IPFS using the modern Pinata SDK.
 * @param {object} metadata - The JSON metadata for the NFT.
 * @returns {Promise<string>} The URI of the uploaded metadata.
 */
export async function uploadMetadataToIpfs(metadata) {
    try {
        console.log('Uploading metadata to IPFS via Pinata...');

        const metadataString = JSON.stringify(metadata);
        const metadataBuffer = Buffer.from(metadataString, 'utf-8');
        const blob = new Blob([metadataBuffer]);
        const file = new File([blob], "metadata.json", { type: "application/json"});

        const result = await pinata.upload.public.file(file);

        console.log('Metadata uploaded. IPFS Hash (CID):', result.cid);
        return `https://${pinata.gateway}/ipfs/${result.cid}`;

    } catch (error) {
        console.error('Error uploading metadata to IPFS:', error);
        throw new Error('Failed to upload metadata to IPFS.');
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
            sellerFeeBasisPoints: 0, 
            isMutable: true, 
            isCollection: true, 
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
 * Adds individual NFT metadata to the Candy Machine in batches.
 * This is a necessary step before minting can begin.
 */
export async function addItemsToCandyMachine(candyMachineAddress, items, batchSize = 5) {
    try {
        const candyMachine = await metaplex.candyMachines().findByAddress({ address: candyMachineAddress });
        
        console.log(`Adding ${items.length} items to Candy Machine in batches of ${batchSize}...`);

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}...`);
            const { response } = await metaplex.candyMachines().insertItems({
                candyMachine,
                items: batch,
            }, { commitment: 'finalized' });
            console.log(`Batch ${Math.floor(i / batchSize) + 1} successfully added. Signature: ${response.signature}`);
        }

        console.log('All items successfully added to Candy Machine.');

    } catch (error) {
        console.error('Error adding items to Candy Machine:', error);
        throw new Error('Failed to add items to Candy Machine.');
    }
}


/**
 * Deploys a Metaplex Candy Machine V3 and adds items to it.
 */
export async function deployCandyMachine(collectionMintAddress, priceInSol, numberOfTickets) {
    try {
        console.log(`Deploying Candy Machine for collection: ${collectionMintAddress.toBase58()}...`);

        const guards = {
            solPayment: {
                amount: { basisPoints: toBigNumber(priceInSol * 1_000_000_000), currency: { symbol: 'SOL', decimals: 9 } },
                destination: adminKeypair.publicKey,
            },
            startDate: { date: toBigNumber(Math.floor(new Date().getTime() / 1000)) },
        };

        const { candyMachine } = await metaplex.candyMachines().create({
            itemsAvailable: toBigNumber(numberOfTickets),
            sellerFeeBasisPoints: 500,
            symbol: 'TICKET',
            maxSupply: toBigNumber(0),
            isMutable: true,
            collection: {
                address: collectionMintAddress,
                updateAuthority: adminKeypair,
            },
            guards: guards,
        }, { commitment: 'finalized' });

        console.log('Candy Machine deployed. ID:', candyMachine.address.toBase58());
        
        console.log('Preparing items to insert into the Candy Machine...');
        const items = [];
        for (let i = 1; i <= numberOfTickets; i++) {
            items.push({
                name: `Event Ticket #${i}`,
                uri: "https://gateway.pinata.cloud/ipfs/Qmd5eR4bXQT32x4N82sGbA28z257NUDYg2P2kxy5u2yB1M" 
            });
        }
        
        await addItemsToCandyMachine(candyMachine.address, items);

        return candyMachine.address;
    } catch (error) {
        console.error('Error deploying Candy Machine:', error);
        throw new Error('Failed to deploy Candy Machine. Ensure your admin wallet has enough SOL and the collection NFT is valid.');
    }
}

/**
 * Verifies the ownership of a cNFT on the Solana blockchain.
 */
export async function verifyTicketOwnershipOnChain(nftMintAddress, expectedOwnerWalletAddress) {
    try {
        console.log(`Verifying ownership for NFT: ${nftMintAddress} by ${expectedOwnerWalletAddress}...`);
        const nftPublicKey = new PublicKey(nftMintAddress);
        const ownerPublicKey = new PublicKey(expectedOwnerWalletAddress);
        const asset = await metaplex.nfts().findByMint({ mintAddress: nftPublicKey });
        if (!asset) {
            console.warn(`NFT with mint address ${nftMintAddress} not found.`);
            return false;
        }
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
        return false;
    }
}

/**
 * Fetches details of a compressed NFT (cNFT) from the blockchain.
 */
export async function getCNFTDetails(nftMintAddress) {
    try {
        const nftPublicKey = new PublicKey(nftMintAddress);
        const asset = await metaplex.nfts().findByMint({ mintAddress: nftPublicKey });
        return asset;
    } catch (error) {
        console.error(`Error fetching cNFT details for ${nftMintAddress}:`, error);
        return null;
    }
}

// Ensure Solana services are initialized on module load
initializeSolana();