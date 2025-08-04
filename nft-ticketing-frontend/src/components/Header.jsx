import React from 'react';
import { Link } from 'react-router-dom';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

const Header = () => {
    return (
        <header className="bg-gray-800 shadow-md">
            <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                <Link to="/" className="text-2xl font-bold text-white">
                    NFTix
                </Link>
                <nav className="flex items-center space-x-6">
                    <Link to="/" className="text-gray-300 hover:text-white">Home</Link>
                    <Link to="/verify-ticket" className="text-gray-300 hover:text-white">Verify Ticket</Link>
                    
                    <WalletMultiButton style={{ backgroundColor: '#5b21b6' }} />
                </nav>
            </div>
        </header>
    );
};

export default Header;