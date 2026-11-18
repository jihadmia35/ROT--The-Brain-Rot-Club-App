import * as SecureStore from 'expo-secure-store';
import {
  AuthStorageAdapter,
  createChunkedSecureStorage,
  SecureStoreBackend,
} from './secureStorageCore';

const expoSecureStoreBackend: SecureStoreBackend = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

export const chunkedSecureStorage: AuthStorageAdapter =
  createChunkedSecureStorage(expoSecureStoreBackend);
