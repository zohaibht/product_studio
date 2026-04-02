import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {  
  Upload,  
  Camera,  
  Image as ImageIcon,  
  Video,  
  CheckCircle2,  
  Loader2,  
  AlertCircle,
  Download,
  Key,
  RotateCcw,
  X,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { cn } from './lib/utils';

// --- Types ---
interface GeneratedItem {
  id: string;
  title: string;
  description: string;
  type: 'image' | 'video';
  status: 'pending' | 'processing' | 'completed' | 'error';
  url?: string;
  prompt: string;
}

// --- Constants ---
const MODELS = {
  ANALYSIS: 'gemini-1.5-flash', // Updated to stable version
  IMAGE: 'gemini-1.5-flash-8b', 
  VIDEO: 'veo-1.0-preview', // Ensure your API key has access to Veo
};

const GENERATION_PLAN: Omit<GeneratedItem, 'id' | 'status'>[] = [
  { title: 'Angle 1', description: 'Professional studio shot from a front-side angle.', type: 'image', prompt: 'Professional studio product photograph of [PRODUCT] from a front-side 45-degree angle, clean white background, soft shadows, studio lighting, high resolution, 4k.' },
  { title: 'Product Video', description: 'A cinematic 360-degree rotation video.', type: 'video', prompt: 'A slow cinematic 360-degree rotation of [PRODUCT] on a clean white background, soft studio lighting, high resolution, smooth motion.' },
  // Aap baqi angles bhi yahan add kar sakte hain...
];

const withRetry = async <T,>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); } 
    catch (err) { 
      lastError = err; 
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i)));
    }
  }
  throw lastError;
};

export default function App() {
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [productDescription, setProductDescription] = useState<string>('');
  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // API Key selection logic simplified for Mobile
  const getApiKey = () => {
    // Vite config se process.env define ho kar yahan aye ga
    return (process.env.GEMINI_API_KEY || process.env.API_KEY) as string;
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedImages(prev => [...prev, e.target?.result as string].slice(0, 5));
        setError(null);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const startGeneration = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      setError("API Key missing! Please add it to GitHub Secrets.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setItems(GENERATION_PLAN.map((p, i) => ({ ...p, id: `item-${i}`, status: 'pending' })));

    try {
      const ai = new GoogleGenAI(apiKey);
      const imageParts = uploadedImages.map(img => ({
        inlineData: { data: img.split(',')[1], mimeType: "image/png" }
      }));

      // 1. Analyze
      const model = ai.getGenerativeModel({ model: MODELS.ANALYSIS });
      const analysisResult = await withRetry(() => model.generateContent([
        "Describe this product in detail for an AI image generator. Focus on shape, material, and texture.",
        ...imageParts
      ]));
      
      const description = analysisResult.response.text();
      setProductDescription(description);

      // 2. Generate Items
      for (let i = 0; i < GENERATION_PLAN.length; i++) {
        setItems(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'processing' } : item));
        
        const item = GENERATION_PLAN[i];
        const finalPrompt = item.prompt.replace('[PRODUCT]', description);

        try {
          if (item.type === 'image') {
            const imgModel = ai.getGenerativeModel({ model: MODELS.IMAGE });
            const result = await withRetry(() => imgModel.generateContent([finalPrompt, ...imageParts]));
            const url = `data:image/png;base64,${result.response.candidates?.[0]?.content?.parts[0].inlineData?.data}`;
            
            setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'completed', url } : it));
          }
          // Video logic remains similar...
        } catch (e) {
          setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'error' } : it));
        }
      }
    } catch (err) {
      setError("Generation failed. Check your API Key and Internet.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 p-4">
      <header className="flex justify-between items-center mb-8 bg-white p-4 rounded-2xl shadow-sm">
        <h1 className="text-xl font-bold">Lumina AI Studio</h1>
        <div className={`h-3 w-3 rounded-full ${getApiKey() ? 'bg-green-500' : 'bg-red-500'}`} title="API Status" />
      </header>

      <main className="max-w-4xl mx-auto space-y-6">
        <div {...useDropzone({ onDrop, accept: {'image/*': []} }).getRootProps()} 
             className="border-2 border-dashed border-neutral-300 p-10 rounded-3xl bg-white text-center cursor-pointer hover:border-neutral-900 transition-all">
          <Upload className="mx-auto mb-4 text-neutral-400" />
          <p className="font-medium">Tap to upload product photos</p>
          <p className="text-sm text-neutral-500">{uploadedImages.length}/5 images</p>
        </div>

        <button 
          onClick={startGeneration}
          disabled={isProcessing || uploadedImages.length === 0}
          className="w-full py-4 bg-neutral-900 text-white rounded-2xl font-bold disabled:bg-neutral-300"
        >
          {isProcessing ? <Loader2 className="animate-spin mx-auto" /> : "Start Studio Shoot"}
        </button>

        {error && <div className="p-4 bg-red-100 text-red-700 rounded-xl flex gap-2"><AlertCircle /> {error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-3xl border border-neutral-200 shadow-sm relative">
              <div className="aspect-square bg-neutral-100 rounded-2xl mb-4 overflow-hidden flex items-center justify-center">
                {item.url ? <img src={item.url} className="w-full h-full object-cover" /> : <ImageIcon className="opacity-10" size={48} />}
                {item.status === 'processing' && <div className="absolute inset-0 bg-white/60 flex items-center justify-center"><Loader2 className="animate-spin" /></div>}
              </div>
              <h3 className="font-bold">{item.title}</h3>
              <p className="text-sm text-neutral-500">{item.description}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
