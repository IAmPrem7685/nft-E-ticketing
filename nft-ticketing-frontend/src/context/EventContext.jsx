import React, { createContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

export const EventContext = createContext();

export const EventProvider = ({ children }) => {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchEvents = useCallback(async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${API_URL}/events`);
            setEvents(response.data);
            setError(null);
        } catch (err) {
            setError('Failed to fetch events.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    const getEventById = useCallback(async (eventId) => {
        try {
            setLoading(true);
            const response = await axios.get(`${API_URL}/events/${eventId}`);
            return response.data;
        } catch (err) {
            console.error(`Failed to fetch event ${eventId}`, err);
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchEvents();
    }, [fetchEvents]);

    return (
        <EventContext.Provider value={{ events, loading, error, fetchEvents, getEventById }}>
            {children}
        </EventContext.Provider>
    );
};