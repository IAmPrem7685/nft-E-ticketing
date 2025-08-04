import bs58 from 'bs58';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
// Paste your private key from the .env file here
const base58PrivateKey = process.env.SOLANA_ADMIN_PRIVATE_KEY

if (!base58PrivateKey || base58PrivateKey === "YOUR_SOLANA_ADMIN_PRIVATE_KEY_FROM_DOTENV") {
    console.error("Please paste your actual private key into the script.");
    process.exit(1);
}

try {
    const secretKey = bs58.decode(base58PrivateKey);
    const keypairArray = Array.from(secretKey);

    // Define the path for the new keypair file in your home directory
    const filePath = path.join(os.homedir(), 'admin-keypair.json');

    fs.writeFileSync(filePath, JSON.stringify(keypairArray));

    console.log(`✅ Success! Your admin keypair has been saved to: ${filePath}`);
    console.log("You can now use this file with the 'sugar mint' command.");

} catch (error) {
    console.error("🛑 Error: Could not decode the private key. Please ensure it is a valid Base58 string.", error.message);
}