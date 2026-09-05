interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_FACILITY_ID?: string;
  readonly VITE_TOKEN_ADDRESS?: string;
  readonly VITE_FACILITY_REGISTRY_ADDRESS?: string;
  readonly VITE_CREDENTIAL_REGISTRY_ADDRESS?: string;
  readonly VITE_COVERAGE_ENGINE_ADDRESS?: string;
  readonly VITE_COVENANT_VAULT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface EthereumProvider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface Window {
  ethereum?: EthereumProvider;
}

