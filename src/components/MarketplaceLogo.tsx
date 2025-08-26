import React from 'react';

interface MarketplaceLogoProps {
  name: string;
  className?: string;
}

const MarketplaceLogo: React.FC<MarketplaceLogoProps> = ({ name, className = "" }) => {
  const logoUrls = {
    eBay: "/src/assets/EBay_logo.svg.png",
    Poshmark: "/src/assets/Poshmark.png", 
    Mercari: "/src/assets/Mercari_logo_2018.svg.png"
  };

  const logoUrl = logoUrls[name as keyof typeof logoUrls];
  
  if (!logoUrl) {
    return <span className="text-sm font-medium text-gray-700">{name}</span>;
  }

  // Special styling for Mercari to ensure proper display
  if (name === 'Mercari') {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <img 
          src={logoUrl} 
          alt={`${name} logo`}
          className="h-full object-contain"
          style={{ 
            maxHeight: '100%',
            width: 'auto'
          }}
        />
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <img 
        src={logoUrl} 
        alt={`${name} logo`}
        className="h-full object-contain"
        style={{ 
          maxHeight: '100%',
          width: 'auto'
        }}
      />
    </div>
  );
};

export default MarketplaceLogo;