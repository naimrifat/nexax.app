// In src/pages/UploadPage.tsx

const handleImageUpload = async (imageFile: File) => {
    setIsLoading(true);
    setStatusMessage('Step 1 of 2: Uploading image...');

    const imgbbApiKey = '7b6ad3d170c93f1a32cf2cef62bfebf5'; // <-- ❗ PASTE YOUR IMGBB KEY HERE
    const yourAIWebhookURL = 'https://hook.us2.make.com/e1e7hqg3p3oh28x8nxx25urjjn92qu06'; // <-- ❗ PASTE YOUR MAKE.COM URL HERE
    
    let imageUrl = '';

    // --- Step 1: Upload the image to ImgBB to get a public URL ---
    try {
        const formData = new FormData();
        formData.append('image', imageFile);

        const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
            method: 'POST',
            body: formData,
        });

        const imgbbData = await imgbbResponse.json();

        if (imgbbData.success) {
            imageUrl = imgbbData.data.url;
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
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image_url: imageUrl }), // Send the URL as JSON
        });

        if (!aiResponse.ok) {
            throw new Error('AI analysis failed. Please try another image.');
        }

        const aiData = await aiResponse.json();
        sessionStorage.setItem('aiListingData', JSON.stringify(aiData));
        
        // Navigate to the results page
        navigate('/results');

    } catch (error: any) {
        setStatusMessage(`Error: ${error.message}`);
        setIsLoading(false);
    }
};
export default UploadPage;
