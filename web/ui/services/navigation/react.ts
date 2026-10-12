import { useSyncExternalStore } from 'react';
import { currentRoute, subscribeRoute } from './history';

export const useRoute = () => useSyncExternalStore(subscribeRoute, currentRoute);
