import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Metaplex, walletAdapterIdentity } from '@metaplex-foundation/js';
import { PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { EventContext } from '../context/EventContext';
import Spinner from '../components/Spinner';

const API_URL = 'http://localhost:3000/api';

const EventPage = () => {
    const { id } = useParams();
    const { getEventById } = useContext(EventContext);
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [purchaseMessage, setPurchaseMessage] = useState('');
    const [isMinting, setIsMinting] = useState(false);

    const { connection } = useConnection();
    const wallet = useWallet();

    const metaplex = useMemo(
        () => wallet.publicKey ? Metaplex.make(connection).use(walletAdapterIdentity(wallet)) : null,
        [connection, wallet]
    );

    useEffect(() => {
        const fetchEvent = async () => {
            setLoading(true);
            const eventData = await getEventById(id);
            setEvent(eventData);
            setLoading(false);
        };
        fetchEvent();
    }, [id, getEventById]);

    const handlePurchase = async () => {
        // Guard against multiple clicks, even though the button is disabled
        if (isMinting) return;

        if (!metaplex || !wallet.publicKey) {
            setPurchaseMessage('Please connect your wallet to purchase.');
            return;
        }

        setIsMinting(true);
        setPurchaseMessage('Preparing transaction...');

        try {
            // 1. Initiate the purchase with your backend
            const initiateResponse = await axios.post(`${API_URL}/events/${id}/purchase-initiate`, {
                userWalletAddress: wallet.publicKey.toBase58(),
            });

            const { candyMachineId, transactionId } = initiateResponse.data;
            const candyMachineAddress = new PublicKey(candyMachineId);
            
            setPurchaseMessage('Please approve the transaction in your wallet...');

            // 2. Fetch the candy machine state from the cluster
            const candyMachine = await metaplex.candyMachines().findByAddress({ address: candyMachineAddress });
            
            // 3. Call the mint function. Metaplex handles sending and confirming.
            const { nft, response } = await metaplex.candyMachines().mint({
                candyMachine,
                collectionUpdateAuthority: candyMachine.authorityAddress, // This is required for v3
            });
            
            // The transaction is already confirmed to the 'confirmed' level at this point.
            // The redundant 'finalized' confirmation is removed.
            setPurchaseMessage('Transaction sent! Updating ticket records...');

            // 4. Notify your backend of the successful mint
            await axios.post(`${API_URL}/tickets/mint-success`, {
                eventId: id,
                nftMintAddress: nft.address.toBase58(),
                ownerWalletAddress: wallet.publicKey.toBase58(),
                solanaTransactionSignature: response.signature,
                transactionId: transactionId,
            });

            setPurchaseMessage(`Success! Your NFT ticket has been minted. Check your wallet!`);
            
            // 5. Refresh event data to show updated ticket count
            const updatedEventData = await getEventById(id);
            if (updatedEventData) setEvent(updatedEventData);

        } catch (err) {
            console.error('Minting error:', err);

            // Improved error message parsing
            let friendlyMessage = 'Minting failed. Please try again.';
            if (err.message.includes('User rejected the request')) {
                friendlyMessage = 'Transaction was rejected in your wallet.';
            } else if (err.message.includes('already been processed')) {
                friendlyMessage = 'Transaction has already been processed.';
            } else if (err.response?.data?.error) {
                friendlyMessage = err.response.data.error;
            }
            
            setPurchaseMessage(friendlyMessage);
        } finally {
            setIsMinting(false);
        }
    };

    if (loading) return <div className="flex justify-center items-center h-64"><Spinner /></div>;
    if (!event) return <div className="text-center text-red-500 text-xl">Event not found.</div>;

    return (
        <div className="bg-gray-800 rounded-lg shadow-lg p-8 max-w-2xl mx-auto">
            <h1 className="text-4xl font-bold mb-4">{event.name}</h1>
            <p className="text-xl text-gray-300 mb-2">{new Date(event.date).toLocaleString()}</p>
            <p className="text-lg text-gray-400 mb-4">{event.venue}</p>
            <p className="text-gray-300 mb-6">{event.description || 'No description available.'}</p>
            <div className="flex justify-between items-center mb-6">
                <span className="text-2xl font-bold text-purple-400">{event.price_sol} SOL</span>
                <span className="text-lg text-gray-400">{event.available_tickets} / {event.total_tickets} available</span>
            </div>
            <button
                onClick={handlePurchase}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors duration-200"
                disabled={!wallet.publicKey || event.available_tickets === 0 || isMinting}
            >
                {isMinting ? <Spinner /> : (event.available_tickets === 0 ? 'Sold Out' : 'Purchase Ticket')}
            </button>
            {purchaseMessage && (
                <p className="mt-4 text-center text-yellow-400">{purchaseMessage}</p>
            )}
        </div>
    );
};

export default EventPage;