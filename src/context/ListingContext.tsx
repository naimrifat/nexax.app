import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ListingContextType {
  photos: File[] | null;
  addPhotos: (files: File[]) => void;
  clearPhotos: () => void;
}

const ListingContext = createContext<ListingContextType | undefined>(undefined);

export const useListing = (): ListingContextType => {
  const context = useContext(ListingContext);
  if (context === undefined) {
    throw new Error('useListing must be used within a ListingProvider');
  }
  return context;
};

interface ListingProviderProps {
  children: ReactNode;
}

export const ListingProvider: React.FC<ListingProviderProps> = ({ children }) => {
  const [photos, setPhotos] = useState<File[] | null>(null);

  const addPhotos = (files: File[]) => {
    setPhotos(files);
  };

  const clearPhotos = () => {
    setPhotos(null);
  };

  return (
    <ListingContext.Provider value={{ photos, addPhotos, clearPhotos }}>
      {children}
    </ListingContext.Provider>
  );
};