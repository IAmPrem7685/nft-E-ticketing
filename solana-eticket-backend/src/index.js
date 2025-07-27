// src/index.js
import express from 'express';
import dotenv from 'dotenv';
import eventRoutes from './routes/eventRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import { startSolanaListener } from './listeners/solanaListener.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json()); // For parsing application/json

// API Routes
app.use('/api/events', eventRoutes);
app.use('/api/tickets', ticketRoutes);

// Basic health check route
app.get('/', (req, res) => {
    res.status(200).send('E-Ticketing Backend is running!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Start the Solana listener after the server starts
    startSolanaListener();
});
