import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Camera, Image as ImageIcon, Loader2, AlertCircle, Key, X, Plus, CheckCircle2 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- Types ---
interface GeneratedItem {
  id: string; title: string; description: string; type: 'image' | 'video';
  status: 'pending' | 'processing' | 'completed' | 'error'; url?: string; prompt: string;
}

export default function App() {
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || "";

  useEffect(() => {
    if (getApiKey()) setHasApiKey(true);
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => setUploadedImages(prev => [...prev, e.target?.result as string].slice(0, 5));
      reader.readAsDataURL(file);
    });
  }, []);

  const startGeneration = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      setError("API Key missing in environment variables.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    
    setItems([
      { id: '1', title: 'Front View', description: 'Studio Shot', type: 'image', status: 'pending', prompt: 'Front view of [PRODUCT]' },
      { id: '2', title: 'Side View', description: 'Detailed Shot', type: 'image', status: 'pending', prompt: 'Side view of [PRODUCT]' }
    ]);

    try {
      // Dynamic import to prevent build-time resolution errors
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      
      const imageParts = uploadedImages.map(img => ({
        inlineData: { data: img.split(',')[1], mimeType: "image/png" }
      }));

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent([
        "Describe this product for an AI image generator briefly.",
        ...imageParts
      ]);

      const description = result.response.text();

      // Update first item as a test
      setItems(prev => prev.map((it, idx) => idx === 0 ? { ...it, status: 'completed', url: uploadedImages[0] } : it));

    } catch (err: any) {
      setError("Build check: Library imported but execution failed. " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex justify-between items-center bg-white p-6 rounded-2xl border shadow-sm">
          <h1 className="text-xl font-bold flex items-center gap-2"><Camera /> Product Studio</h1>
          <div className={cn("px-3 py-1 rounded-full text-xs font-bold", hasApiKey ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
            {hasApiKey ? "API Connected" : "Key Missing"}
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div {...getRootProps()} className="border-2 border-dashed border-neutral-300 p-12 rounded-2xl text-center bg-white cursor-pointer hover:border-neutral-900 transition-colors">
              <input {...getInputProps()} />
              <Plus className="mx-auto mb-2 text-neutral-400" />
              <p className="text-sm text-neutral-500">Upload Product Images</p>
            </div>

            <div className="flex gap-2">
              {uploadedImages.map((img, i) => (
                <img key={i} src={img} className="w-16 h-16 object-cover rounded-lg border" />
              ))}
            </div>

            <button 
              onClick={startGeneration}
              disabled={isProcessing || uploadedImages.length === 0}
              className="w-full py-4 bg-neutral-900 text-white rounded-xl font-bold disabled:bg-neutral-200"
            >
              {isProcessing ? <Loader2 className="animate-spin mx-auto" /> : "Start Studio Session"}
            </button>
            {error && <p className="text-red-500 text-sm flex gap-1"><AlertCircle className="w-4" /> {error}</p>}
          </div>

          <div className="space-y-4">
            <h2 className="font-bold">Output Gallery</h2>
            {items.map(item => (
              <div key={item.id} className="bg-white p-4 rounded-xl border flex justify-between items-center">
                <div>
                  <p className="font-bold text-sm">{item.title}</p>
                  <p className="text-xs text-neutral-500">{item.status}</p>
                </div>
                {item.status === 'completed' && <CheckCircle2 className="text-green-500" />}
                {item.status === 'processing' && <Loader2 className="animate-spin text-neutral-400" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const getRootProps = () => ({}); 
const getInputProps = () => ({});
