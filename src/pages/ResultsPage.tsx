// src/pages/ResultsPage.tsx

import React, { useState, useEffect } from 'react';
import './ResultsPage.css'; // We will create this CSS file in the next step

const ResultsPage = () => {
    // State for the form fields
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');
    const [itemSpecifics, setItemSpecifics] = useState({});
    
    // This is the main function that runs once when the page loads
    useEffect(() => {
        // 1. Retrieve the data string from session storage
        const storedDataString = sessionStorage.getItem('aiListingData');

        if (storedDataString) {
            console.log("Found AI data. Populating page...");
            // 2. Convert the string back into a JSON object
            const aiData = JSON.parse(storedDataString);

            // 3. Update the component's state with the AI data
            setTitle(aiData.title || '');
            setDescription(aiData.description || '');
            setPrice(aiData.price_suggestion?.optimal || '');
            setItemSpecifics(aiData.specifics || {});

            // 4. (Optional but recommended) Clean up the storage
            sessionStorage.removeItem('aiListingData');
        } else {
            console.log("No AI data found in session storage.");
        }
    }, []); // The empty array [] means this effect runs only once on page load


    return (
        <div className="page-background">
            <div className="container">
                <div className="header">
                    <div className="logo-section">
                        <div className="snapline-logo">📸</div>
                        <h1>Create eBay Listing</h1>
                    </div>
                    {/* Additional header content can go here */}
                </div>

                <div className="main-content">
                    {/* Left Column for the main form */}
                    <div className="form-section">
                        {/* Title & Details Section */}
                        <div>
                            <div className="section-header">
                                <div className="section-icon">📝</div>
                                <div className="section-title">Title & Details</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Title</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="AI will generate a title here..."
                                />
                            </div>
                        </div>

                        {/* Item Specifics Section */}
                        <div>
                            <div className="section-header">
                                <div className="section-icon">📋</div>
                                <div className="section-title">Item Details</div>
                            </div>
                            <div className="form-fields-grid">
                                {Object.entries(itemSpecifics).map(([key, value]) => (
                                    <div className="form-group" key={key}>
                                        <label className="form-label">{key}</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            defaultValue={value as string}
                                            // You might want a more complex state management for specifics if they are editable
                                        />
                                    </div>
                                ))}
                            </div>
                             <div className="form-group">
                                <label className="form-label">Product Description</label>
                                <textarea
                                    className="form-input"
                                    rows={8}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="AI will generate a description here..."
                                ></textarea>
                            </div>
                        </div>
                    </div>

                    {/* Right Column for the Preview Panel */}
                    <div className="preview-panel">
                         <div className="preview-header">
                            <h3 className="preview-title">eBay Preview</h3>
                        </div>
                        <div className="ebay-preview-frame">
                            <div className="ebay-header-sim">eBay</div>
                            <div className="preview-content">
                                <div className="preview-image">📷 Product Photo</div>
                                <div className="preview-title-text">{title || "Your Product Title"}</div>
                                <div className="preview-price">US ${parseFloat(price || '0').toFixed(2)}</div>
                                <div className="preview-details">
                                    {Object.entries(itemSpecifics).map(([key, value]) => (
                                        <div key={key}><strong>{key}:</strong> {value as string}</div>
                                    ))}
                                </div>
                            </div>
                        </div>
                         {/* Pricing Section can be added here */}
                         <div className="form-group">
                            <label className="form-label">Price</label>
                            <input
                                type="number"
                                className="form-input"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="0.00"
                            />
                        </div>
                    </div>
                </div>
                 <div className="action-buttons">
                    <button className="btn btn-secondary">💾 Save Draft</button>
                    <button className="btn btn-primary">🚀 List on eBay</button>
                </div>
            </div>
        </div>
    );
};

export default ResultsPage;
