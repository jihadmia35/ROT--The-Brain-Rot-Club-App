import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistedAppState } from '../constants/types';
import { CloudProfile } from './authHelpers';
import {
  AppStateStorageAdapter,
  GUEST_STORAGE_KEY,
  loadPersistedStateForOwner,
  savePersistedStateForOwner,
} from './accountStorageCore';
import { getLocalDateKey } from './domainLogic';

export const STORAGE_KEY = GUEST_STORAGE_KEY;

const asyncStorageAdapter: AppStateStorageAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

export async function loadPersistedState(
  dateKey: string = getLocalDateKey(),
  userId: string | null = null,
  options?: {
    templateState?: PersistedAppState | null;
    cloudProfile?: CloudProfile | null;
  }
): Promise<PersistedAppState> {
  return loadPersistedStateForOwner(
    asyncStorageAdapter,
    userId,
    dateKey,
    options
  );
}

export async function savePersistedState(
  state: PersistedAppState,
  userId: string | null = null
): Promise<void> {
  await savePersistedStateForOwner(asyncStorageAdapter, userId, state);
}
