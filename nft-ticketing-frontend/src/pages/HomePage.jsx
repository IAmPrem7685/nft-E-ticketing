import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { EventContext } from '../context/EventContext';
import Spinner from '../components/Spinner';

const HomePage = () => {
    const { events, loading, error } = useContext(EventContext);

    if (loading) {
        return <div className="flex justify-center items-center h-64"><Spinner /></div>;
    }

    if (error) {
        return <div className="text-center text-red-500 text-xl">{error}</div>;
    }

    return (
        <div>
            <h1 className="text-4xl font-bold mb-8 text-center">Upcoming Events</h1>
            {events.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {events.map((event) => (
                        <div key={event.event_id} className="bg-gray-800 rounded-lg shadow-lg overflow-hidden transform hover:scale-105 transition-transform duration-300">
                            <img src="https://placehold.co/500x300/1a202c/FFFFFF?text=Event" alt={event.name} className="w-full h-48 object-cover" />
                            <div className="p-6">
                                <h2 className="text-2xl font-bold mb-2">{event.name}</h2>
                                <p className="text-gray-400 mb-2">{new Date(event.date).toLocaleDateString()}</p>
                                <p className="text-gray-300 mb-4">{event.venue}</p>
                                <Link to={`/event/${event.event_id}`} className="inline-block bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded">
                                    View Details
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-center text-gray-400">No events found.</p>
            )}
        </div>
    );
};

export default HomePage;