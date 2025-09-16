// src/pages/UploadPage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const imgbbApiKey = '7b6ad3d170c93f1a32cf2cef62bfebf5'; // ⚠️ move to env/server
const yourAIWebhookURL = 'https://hook.us2.make.com/e1e7hqg3p3oh28x8nxx25urjjn92qu06';

const UploadPage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleImageUpload = async (imageFile: File) => {
    setIsLoading(true);
    setStatusMessage('Step 1 of 2: Uploading image...');

    let imageUrl = '';

    // --- Step 1: upload image to ImgBB ---
    try {
      const formData = new FormData();
      formData.append('image', imageFile);

      const imgbbResponse = await fetch(
        `https://api.imgbb.com/1/upload?key=${imgbbApiKey}`,
        { method: 'POST', body: formData }
      );

      if (!imgbbResponse.ok) throw new Error('Image hosting request failed');

      const imgbbData = await imgbbResponse.json();
      imageUrl = imgbbData?.data?.url;
      if (!imgbbData?.success || !imageUrl) {
        throw new Error('Image hosting failed');
      }
    } catch (err) {
      console.error('[ImgBB] error:', err);
      setStatusMessage('Error: Could not upload the image. Please try again.');
      setIsLoading(false);
      return;
    }

    // --- Step 2: call Make webhook with the public URL ---
    try {
      setStatusMessage('Step 2 of 2: Analyzing image...');

      const aiResponse = await fetch(yourAIWebhookURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      });

      if (!aiResponse.ok) {
        throw new Error(`AI analysis failed (status ${aiResponse.status})`);
      }

      // Get the sessionId from Make.com (via your Vercel API)
      const responseData = await aiResponse.json();
      console.log('[Webhook] response:', responseData);

      if (!responseData.sessionId) {
        throw new Error('No sessionId received from server');
      }

      // Redirect to results page with sessionId
      navigate(`/results?session=${responseData.sessionId}`);
      
    } catch (err: any) {
      console.error('[Webhook] error:', err);
      setStatusMessage(`Error: ${err?.message ?? 'Unknown error'}`);
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
