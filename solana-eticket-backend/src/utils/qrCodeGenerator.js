// src/utils/qrCodeGenerator.js
import QRCode from 'qrcode';

/**
 * Generates a QR code data URL from the given text data.
 * @param {string} data The text data to encode in the QR code (e.g., NFT mint address).
 * @returns {Promise<string>} A promise that resolves with the data URL of the QR code.
 */
export async function generateQrCodeDataUrl(data) {
    try {
        const qrCodeDataUrl = await QRCode.toDataURL(data, { errorCorrectionLevel: 'H' });
        return qrCodeDataUrl;
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw new Error('Failed to generate QR code.');
    }
}
