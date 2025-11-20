
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { AspectSchema } from '../types';

// Fetcher function to get specific aspect rules from eBay
const fetchSpecifics = async (categoryId: string): Promise<AspectSchema[]> => {
  const { data } = await axios.post('/api/ebay-categories', {
    action: 'getCategorySpecifics',
    categoryId
  });

  // Normalize API response to our clean Schema
  return (data.aspects || []).map((aspect: any) => ({
    name: aspect.name,
    required: !!aspect.required,
    selectionOnly: aspect.selectionOnly, // Your API returns this flag now
    freeTextAllowed: aspect.freeTextAllowed,
    multi: !!aspect.multi,
    values: aspect.values || [],
    type: aspect.type
  }));
};

// The Hook that ResultsPage consumes
export function useCategorySpecifics(categoryId: string | undefined) {
  return useQuery({
    queryKey: ['category-specifics', categoryId],
    queryFn: () => fetchSpecifics(categoryId!),
    enabled: !!categoryId, // Only fetch if ID exists
    staleTime: 1000 * 60 * 10, // Cache for 10 minutes
  });
}
