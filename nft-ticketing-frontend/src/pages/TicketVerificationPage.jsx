import React, { useState } from 'react';
import axios from 'axios';
import Spinner from '../components/Spinner';

const API_URL = 'http://localhost:3000/api';

const TicketVerificationPage = () => {
    const [nftMintAddress, setNftMintAddress] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(false);

    const handleVerify = async (e) => {
        e.preventDefault();
        if (!nftMintAddress) {
            setMessage('Please enter an NFT Mint Address.');
            setIsError(true);
            return;
        }

        setLoading(true);
        setMessage('');
        setIsError(false);

        try {
            const response = await axios.post(`${API_URL}/tickets/verify`, { nftMintAddress });
            setMessage(response.data.message);
        } catch (err) {
            setMessage(err.response?.data?.error || 'Verification failed.');
            setIsError(true);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-md mx-auto">
            <h1 className="text-4xl font-bold mb-8 text-center">Verify Ticket</h1>
            <form onSubmit={handleVerify} className="bg-gray-800 p-8 rounded-lg shadow-lg">
                <div className="mb-4">
                    <label htmlFor="nftMintAddress" className="block text-gray-300 text-sm font-bold mb-2">
                        Ticket NFT Mint Address
                    </label>
                    <input
                        type="text"
                        id="nftMintAddress"
                        value={nftMintAddress}
                        onChange={(e) => setNftMintAddress(e.target.value)}
                        className="shadow appearance-none border rounded w-full py-2 px-3 bg-gray-200 text-gray-800 leading-tight focus:outline-none focus:shadow-outline"
                        placeholder="Enter NFT mint address"
                    />
                </div>
                <button
                    type="submit"
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline disabled:bg-gray-500"
                    disabled={loading}
                >
                    {loading ? <Spinner /> : 'Verify Ticket'}
                </button>
            </form>
            {message && (
                <div className={`mt-4 text-center p-4 rounded ${isError ? 'bg-red-800 text-white' : 'bg-green-800 text-white'}`}>
                    {message}
                </div>
            )}
        </div>
    );
};

export default TicketVerificationPage;