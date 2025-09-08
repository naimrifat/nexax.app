// src/pages/UploadPage.tsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './UploadPage.css'; // We will create this CSS file next

const UploadPage = () => {
    const [statusMessage, setStatusMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            handleImageUpload(file);
        }
    };

    const handleImageUpload = async (imageFile: File) => {
        setIsLoading(true);
        setStatusMessage('Uploading and analyzing image... Please wait.');

        const yourAIWebhookURL = 'https://hook.us2.make.com/e1e7hqg3p3oh28x8nxx25urjjn92qu06'; // <-- ❗ PASTE YOUR URL HERE

        try {
            const formData = new FormData();
            formData.append('image', imageFile);

            const response = await fetch(yourAIWebhookURL, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('AI analysis failed. Please try another image.');
            }

            const aiData = await response.json();
            sessionStorage.setItem('aiListingData', JSON.stringify(aiData));
            
            // Navigate to the results page after success
            navigate('/results');

        } catch (error: any) {
            setStatusMessage(`Error: ${error.message}`);
            setIsLoading(false);
        }
    };

    return (
        <div className="upload-page-background">
            <div className="upload-container">
                <h1>Generate a New Listing</h1>
                <p>Upload a product photo to get started. Our AI will handle the rest.</p>
                
                <input 
                    type="file" 
                    id="imageInput" 
                    accept="image/*" 
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                    disabled={isLoading}
                />
                
                <button 
                    className="upload-btn" 
                    onClick={() => document.getElementById('imageInput')?.click()}
                    disabled={isLoading}
                >
                    {isLoading ? 'Processing...' : '📷 Upload Photo'}
                </button>
                
                <div className="status-message">{statusMessage}</div>
            </div>
        </div>
    );
};

export default UploadPage;
