import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Upload, X, PlusCircle, Image, Sparkles, CheckCircle, ArrowRight, Camera, AlertCircle, ShoppingBag, Award, Smartphone, Edit, Tag } from 'lucide-react';
import MarketplaceLogo from '../components/MarketplaceLogo'; // Assuming you have this component

export default function HomePage() {
    // --- Real State Management ---
    const [photos, setPhotos] = useState<File[]>([]);
    const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState('');
    const [results, setResults] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('eBay');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- YOUR CREDENTIALS ---
    const imgbbApiKey = '7b6ad3d170c93f1a32cf2cef62bfebf5';
    const makeWebhookUrl = 'https://hook.us2.make.com/e1e7hqg3p3oh28x8nxx25urjjn92qu06';

    // --- Photo Handling Functions ---
    const handlePhotoUpload = (files: FileList | null) => {
        if (!files) return;
        const newFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (photos.length + newFiles.length > 8) {
            alert("You can upload a maximum of 8 photos.");
            return;
        }
        const newUrls = newFiles.map(file => URL.createObjectURL(file));
        setPhotos(prev => [...prev, ...newFiles]);
        setPhotoPreviewUrls(prev => [...prev, ...newUrls]);
    };
    
    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handlePhotoUpload(e.target.files);
    };

    const removePhoto = (indexToRemove: number) => {
        URL.revokeObjectURL(photoPreviewUrls[indexToRemove]);
        setPhotos(prev => prev.filter((_, index) => index !== indexToRemove));
        setPhotoPreviewUrls(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const triggerFileInput = () => fileInputRef.current?.click();
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = () => setIsDragging(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handlePhotoUpload(e.dataTransfer.files);
    };
    
    // --- The REAL Submission Logic ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (photos.length === 0) {
            setStatus('Please upload at least one image.');
            return;
        }
        setIsLoading(true);
        setResults(null);
        setStatus('Starting process...');
        console.log('--- Starting Generation ---');
        try {
            setStatus('Step 1 of 2: Uploading your main image...');
            const mainPhoto = photos[0];
            const formData = new FormData();
            formData.append('image', mainPhoto);
            console.log('Uploading main image to ImgBB...');
            const imgResponse = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
                method: 'POST',
                body: formData,
            });
            if (!imgResponse.ok) throw new Error('Image upload failed. Please check the image file.');
            const imgData = await imgResponse.json();
            if (!imgData.success) throw new Error(imgData.error?.message || 'Unknown error uploading image.');
            const imageUrl = imgData.data.url;
            console.log('Image uploaded successfully:', imageUrl);
            setStatus('Step 2 of 2: Analyzing image with AI...');
            const payload = { image_url: imageUrl };
            console.log('Sending payload to Make.com:', payload);
            const makeResponse = await fetch(makeWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!makeResponse.ok) {
                const errorData = await makeResponse.json();
                throw new Error(errorData.message || 'The AI engine returned an error.');
            }
            const resultData = await makeResponse.json();
            console.log('Received results from Make.com:', resultData);
            setResults(resultData);
            setStatus('Success! Your listing is ready.');
        } catch (error: any) {
            console.error('An error occurred:', error);
            setStatus(`Error: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };
    
    // --- JSX to Render the Page ---
    return (
        <div className="
