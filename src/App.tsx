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
  Maximize2,
  ChevronRight,
  Download,
  Key,
  RotateCcw,
  X,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenerativeAI } from "@google/genai"; 
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

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// --- Constants ---
const MODELS = {
  ANALYSIS: 'gemini-1.5-flash', 
  IMAGE: 'imagen-3', 
  VIDEO: 'veo-1', 
};

const GENERATION_PLAN: Omit<GeneratedItem, 'id' | 'status'>[] = [
  { title: 'Front Angle', description: 'Professional studio shot from 45-degree angle.', type: 'image', prompt: 'Professional studio product photograph of [PRODUCT] from a front-side 45-degree angle, clean white background, soft shadows, studio lighting, high resolution, 4k.' },
  { title: 'Side Profile', description: 'Clean side angle for dimensions.', type: 'image', prompt: 'Professional studio product photograph of [PRODUCT] from a side profile angle, clean white background, soft shadows, studio lighting, high resolution, 4k.' },
  { title: 'Macro Detail', description: 'Extreme closeup of textures.', type: 'image', prompt: 'Professional macro closeup photograph of [PRODUCT] showing fine texture and intricate details, clean white background, studio lighting, high resolution.' },
  { title: 'Minimalist Title', description: 'Product on a subtle grey circle.', type: 'image', prompt: 'A professional title photograph of [PRODUCT] placed on a small subtle grey circle on a clean white background. Soft shadows, high resolution.' },
];

// --- Helper for Retries ---
const withRetry = async <T,>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 2000
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isRetryable = 
        err.message?.includes("503") || 
        err.message?.includes("high demand") ||
        err.status === "UNAVAILABLE";

      if (!isRetryable || i === maxRetries - 1) throw err;
      const delay = initialDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

export default function App() {
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [productDescription, setProductDescription] = useState<string>('');
  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Robust API Key retrieval
  const getApiKey = () => {
    return (
      import.meta.env.VITE_GEMINI_API_KEY || 
      (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : "") ||
      ""
    );
  };

  useEffect(() => {
    const key = getApiKey();
    if (key) {
      setHasApiKey(true);
    } else if (window.aistudio) {
      window.aistudio.hasSelectedApiKey().then(setHasApiKey);
    }
  }, []);

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setUploadedImages(prev => [...prev, result].slice(0, 5));
        setError(null);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
  });

  const startGeneration = async () => {
    const apiKey = getApiKey();
    if (uploadedImages.length === 0 || (!apiKey && !window.aistudio)) {
      setError("Please ensure API key is configured.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    
    const initialItems: GeneratedItem[] = GENERATION_PLAN.map((p, i) => ({
      ...p,
      id: `item-${i}`,
      status: 'pending',
    }));
    setItems(initialItems);

    try {
      // 1. Initialize Gemini
      const genAI = new GoogleGenerativeAI(apiKey);
      
      const imageParts = uploadedImages.map(img => ({
        inlineData: { data: img.split(',')[1], mimeType: "image/png" }
      }));

      // 2. Analyze Product
      const model = genAI.getGenerativeModel({ model: MODELS.ANALYSIS });
      const result = await withRetry(() => model.generateContent([
        "Analyze these images. Describe the product in detail for an AI generator. Focus on shape, texture, and materials. Be concise.",
        ...imageParts
      ]));

      const description = result.response.text();
      setProductDescription(description);

      // 3. Generate individual items from plan
      for (let i = 0; i < initialItems.length; i++) {
        setItems(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: 'processing' } : item
        ));

        try {
          const item = initialItems[i];
          const finalPrompt = item.prompt.replace('[PRODUCT]', description);
          
          const imageModel = genAI.getGenerativeModel({ model: MODELS.IMAGE });
          const genResult = await withRetry(() => imageModel.generateContent([
            finalPrompt,
            ...imageParts
          ]));

          // Note: Image extraction depends on model response format
          const candidate = genResult.response.candidates?.[0];
          const inlineData = candidate?.content.parts.find(p => p.inlineData)?.inlineData;

          if (inlineData) {
            const generatedUrl = `data:image/png;base64,${inlineData.data}`;
            setItems(prev => prev.map((it, idx) => 
              idx === i ? { ...it, status: 'completed', url: generatedUrl } : it
            ));
          } else {
            // Fallback for demo if model doesn't return image (e.g. Free Tier)
            throw new Error("No image data returned");
          }

        } catch (err) {
          console.error(`Item ${i} failed:`, err);
          setItems(prev => prev.map((it, idx) => 
            idx === i ? { ...it, status: 'error' } : it
          ));
        }
      }
    } catch (err: any) {
      setError("Analysis failed. Check your API key connection and quota.");
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-neutral-900 rounded-lg flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Product Studio</h1>
          </div>
          
          {!hasApiKey && (
            <button
              onClick={handleOpenKeyDialog}
              className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-sm font-medium hover:bg-amber-100 transition-colors border border-amber-200"
            >
              <Key className="w-4 h-4" />
              Connect API Key
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid lg:grid-cols-12 gap-12">
          {/* Left Column: Upload & Controls */}
          <div className="lg:col-span-4 space-y-8">
            <section className="space-y-4">
              <h2 className="text-2xl font-bold tracking-tight">Source Product</h2>
              <div className="grid grid-cols-2 gap-4">
                <AnimatePresence>
                  {uploadedImages.map((img, idx) => (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      key={idx} 
                      className="relative aspect-square rounded-xl border overflow-hidden bg-white group shadow-sm"
                    >
                      <img src={img} className="w-full h-full object-contain p-2" />
                      <button 
                        onClick={() => removeImage(idx)} 
                        className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {uploadedImages.length < 5 && (
                  <div {...getRootProps()} className={cn(
                    "relative aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors",
                    isDragActive ? "bg-neutral-100 border-neutral-400" : "bg-white border-neutral-200 hover:border-neutral-300"
                  )}>
                    <input {...getInputProps()} />
                    <Plus className="w-6 h-6 text-neutral-400" />
                    <span className="text-[10px] text-neutral-400 mt-1 uppercase font-bold">Add Photo</span>
                  </div>
                )}
              </div>

              <button
                onClick={startGeneration}
                disabled={uploadedImages.length === 0 || isProcessing}
                className={cn(
                  "w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2",
                  (uploadedImages.length === 0 || isProcessing) 
                    ? "bg-neutral-200 text-neutral-400 cursor-not-allowed" 
                    : "bg-neutral-900 text-white hover:bg-black active:scale-[0.98]"
                )}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="animate-spin w-5 h-5" />
                    Processing...
                  </>
                ) : "Generate Photography"}
              </button>

              {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-xl flex gap-2 text-sm border border-red-100">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {error}
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Gallery */}
          <div className="lg:col-span-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold">Studio Gallery</h2>
              <span className="text-sm text-neutral-500 font-medium">
                {items.filter(i => i.status === 'completed').length} / {items.length} Ready
              </span>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              {items.length === 0 ? (
                <div className="col-span-full h-64 border-2 border-dashed border-neutral-200 rounded-3xl flex flex-col items-center justify-center text-neutral-400">
                  <ImageIcon className="w-12 h-12 mb-2 opacity-20" />
                  <p>Upload images to start generation</p>
                </div>
              ) : (
                items.map((item) => (
                  <motion.div 
                    layout
                    key={item.id} 
                    className="bg-white rounded-3xl border border-neutral-200 overflow-hidden group shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="aspect-square relative bg-neutral-100 flex items-center justify-center">
                      {item.status === 'processing' && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                          <Loader2 className="animate-spin text-neutral-900 w-8 h-8 mb-2" />
                          <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">Creating</span>
                        </div>
                      )}
                      
                      {item.status === 'error' && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-red-50">
                          <AlertCircle className="text-red-400 w-8 h-8 mb-2" />
                          <span className="text-xs font-bold text-red-400">Failed to Generate</span>
                        </div>
                      )}

                      {item.url ? (
                        <img src={item.url} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" alt={item.title} />
                      ) : (
                        <ImageIcon className="w-12 h-12 text-neutral-200" />
                      )}

                      {item.status === 'completed' && (
                        <div className="absolute top-4 right-4">
                          <CheckCircle2 className="w-6 h-6 text-green-500 fill-white" />
                        </div>
                      )}
                    </div>
                    
                    <div className="p-6">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 bg-neutral-100 rounded text-neutral-500">
                          {item.type}
                        </span>
                        <h3 className="font-bold text-neutral-900">{item.title}</h3>
                      </div>
                      <p className="text-sm text-neutral-500 leading-relaxed">{item.description}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
