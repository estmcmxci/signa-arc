import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import '../design/tokens.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { Toaster } from 'sonner';
import { Desk } from './Desk';

// No WagmiProvider: the desk holds no wallet connector and signs nothing. The only
// thing signed anywhere on this page is a waiver, by two people, through the approver
// service — see WaiverPanel.tsx. Toasts here track that lifecycle, not a wallet's.
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,retryDelay:n=>Math.min(1000*2**n,8000),refetchOnWindowFocus:true}}});
const node=document.getElementById('app');
if(!node)throw new Error('Missing app root');
createRoot(node).render(<StrictMode><QueryClientProvider client={queryClient}><Tooltip.Provider><Desk/><Toaster position="bottom-right" closeButton richColors/></Tooltip.Provider></QueryClientProvider></StrictMode>);
