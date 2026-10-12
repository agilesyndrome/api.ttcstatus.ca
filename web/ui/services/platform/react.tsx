import { createContext, useContext, useEffect, useState } from 'react';
import { platform } from './index';

/** Retained screens stop acquisition without discarding their map, camera, or form state. */
export const ScreenActiveContext = createContext(true);
export const useScreenActive = () => useContext(ScreenActiveContext);
export function useActivity() {
  const [activity, setActivity] = useState(() => platform().lifecycle.current());
  useEffect(() => platform().lifecycle.subscribe(setActivity), []);
  const screen = useScreenActive();
  return { ...activity, active: activity.active && screen };
}
