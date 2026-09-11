import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import '../design/tokens.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { arcTestnet } from 'viem/chains';
import { Tooltip } from '@base-ui/react/tooltip';
import { Toaster } from 'sonner';
import { Desk } from './Desk';

export const config=createConfig({chains:[arcTestnet],connectors:[injected()],transports:{[arcTestnet.id]:http()},multiInjectedProviderDiscovery:true});
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,retryDelay:n=>Math.min(1000*2**n,8000),refetchOnWindowFocus:true}}});
const node=document.getElementById('app');
if(!node)throw new Error('Missing app root');
createRoot(node).render(<StrictMode><WagmiProvider config={config}><QueryClientProvider client={queryClient}><Tooltip.Provider><Desk/><Toaster position="bottom-right" closeButton richColors/></Tooltip.Provider></QueryClientProvider></WagmiProvider></StrictMode>);
