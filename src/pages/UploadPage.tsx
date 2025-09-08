// src/pages/UploadPage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const imgbbApiKey = '7b6ad3d170c93f1a32cf2cef62bfebf5'; // ⚠️ move to env/server if possible
const yourAIWebhookURL = 'https://hook.us2.make.com/e1e7hqg3p3oh28x8nxx25urjjn92qu06'; // ⚠️ same note

const UploadPage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleImageUpload = async (imageFile: File) => {
    setIsLoading(true);
    setStatusMessage('Step 1 of 2: Uploading image...');

    let imageUrl = '';

    // --- Step 1: Upload the image to ImgBB to get a public URL ---
    try {
      const formData = new FormData();
      formData.append('image', imageFile);

      const imgbbResponse = await fetch(
        `https://api.imgbb.com/1/upload?key=${imgbbApiKey}`,
        { method: 'POST', body: formData }
      );

      if (!imgbbResponse.ok) throw new Error('Image hosting request failed.');

      const imgbbData = await imgbbResponse.json();
      if (imgbbData?.success && imgbbData?.data?.url) {
        imageUrl = imgbbData.data.url as string;
      } else {
        throw new Error('Image hosting failed.');
      }
    } catch (error) {
      setStatusMessage('Error: Could not upload the image. Please try again.');
      setIsLoading(false);
      return;
    }

    // --- Step 2: Send the public URL to your Make.com webhook ---
    try {
      setStatusMessage('Step 2 of 2: Analyzing image...');

      const aiResponse = await fetch(yourAIWebhookURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      });

      if (!aiResponse.ok) {
        throw new Error('AI analysis failed. Please try another image.');
      }

      const aiData = await aiResponse.json();
      sessionStorage.setItem('aiListingData', JSON.stringify(aiData));

      // Navigate to the results page
      navigate('/results');
    } catch (error: any) {
      setStatusMessage(`Error: ${error.message ?? 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleImageUpload(file);
  };

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h1>Create Listing</h1>
      <p>Upload a product photo to generate a draft listing.</p>

      <input
        type="file"
        accept="image/*"
        onChange={onFileChange}
        disabled={isLoading}
        style={{ marginTop: 12 }}
      />

      {statusMessage && (
        <p style={{ marginTop: 12 }}>{isLoading ? '⏳ ' : ''}{statusMessage}</p>
      )}
    </div>
  );
};

export default UploadPage;
