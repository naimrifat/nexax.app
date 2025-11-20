import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { AiData } from '../types'; // <--- Now using shared types

const fetchListingData = async (sessionId: string | null): Promise<AiData | null> => {
  if (sessionId) {
    try {
      const { data } = await axios.get(`/api/listing-data/${sessionId}`);
      // Handle the nested structure your API might return
      return data.data || data.analysis || data;
    } catch (err) {
      console.warn("API Fetch failed", err);
      return null;
    }
  }

  const raw = sessionStorage.getItem('aiListingData');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.data || parsed.analysis || parsed;
    } catch (e) {
      return null;
    }
  }

  return null;
};

export function useListingData() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');

  return useQuery({
    queryKey: ['listing-data', sessionId || 'local'],
    queryFn: () => fetchListingData(sessionId),
    staleTime: Infinity, 
    retry: false,
    refetchOnWindowFocus: false,
  });
}
