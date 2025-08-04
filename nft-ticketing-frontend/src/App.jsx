import React, { useMemo } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { WalletProvider, ConnectionProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import Header from './components/Header';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import EventPage from './pages/EventPage';
import TicketVerificationPage from './pages/TicketVerificationPage';

import { EventProvider } from './context/EventContext';

// Default styles for the wallet adapter
import '@solana/wallet-adapter-react-ui/styles.css';

// Polyfill Buffer for the browser
import { Buffer } from 'buffer';
window.Buffer = Buffer;


const App = () => {
    const network = 'devnet';
    const endpoint = useMemo(() => clusterApiUrl(network), [network]);
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <EventProvider>
                        <Router>
                            <div className="flex flex-col min-h-screen bg-gray-900 text-gray-100">
                                <Header />
                                <main className="flex-grow container mx-auto px-4 py-8">
                                    <Routes>
                                        <Route path="/" element={<HomePage />} />
                                        <Route path="/event/:id" element={<EventPage />} />
                                        <Route path="/verify-ticket" element={<TicketVerificationPage />} />
                                        
                                    </Routes>
                                </main>
                                <Footer />
                            </div>
                        </Router>
                    </EventProvider>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};





export default App;