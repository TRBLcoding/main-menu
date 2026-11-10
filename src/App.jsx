import { useState, useEffect, useMemo } from 'react';
import { pb } from './pocketbaseClient';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { Search, Plus, Clock, Users, ChefHat, X, Loader2, Trash2, Wand2, PenLine, ImagePlus, Edit2, Sun, Moon } from 'lucide-react';
import imageCompression from 'browser-image-compression';

const genAI = new GoogleGenerativeAI(window.HA_CONFIG.GEMINI_API_KEY);

const emptyManualRecipe = {
  title: '',
  summary: '',
  prep_time_minutes: 0,
  cook_time_minutes: 0,
  servings: 1,
  image_url: '', 
  ingredients: [{ amount: '', unit: '', name: '' }],
  instructions: ['']
};

async function fileToGenerativePart(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({ inlineData: { data: reader.result.split(',')[1], mimeType: file.type } });
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [recipes, setRecipes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  
  // UI & Dark Mode States
  const [darkMode, setDarkMode] = useState(false);
  const [detailTab, setDetailTab] = useState('recipe'); // 'recipe' | 'manage'
  const [wakeLock, setWakeLock] = useState(null);

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addMode, setAddMode] = useState('ai'); 
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  
  // AI States
  const [aiInputMode, setAiInputMode] = useState('text');
  const [pasteText, setPasteText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importImage, setImportImage] = useState(null);
  const [isParsing, setIsParsing] = useState(false);

  // Manual/Edit Entry States
  const [manualRecipe, setManualRecipe] = useState(emptyManualRecipe);
  const [imageFile, setImageFile] = useState(null); 
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // --- DARK MODE TOGGLE ---
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('bg-gray-900', 'text-gray-100');
      document.body.classList.remove('bg-gray-50', 'text-gray-900');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.add('bg-gray-50', 'text-gray-900');
      document.body.classList.remove('bg-gray-900', 'text-gray-100');
    }
  }, [darkMode]);

  // --- KEEP SCREEN ON WAKE LOCK ---
  useEffect(() => {
    const requestWakeLock = async () => {
      if (isDetailModalOpen && 'wakeLock' in navigator) {
        try {
          const lock = await navigator.wakeLock.request('screen');
          setWakeLock(lock);
        } catch (err) {
          console.error("Wake Lock error:", err);
        }
      } else if (!isDetailModalOpen && wakeLock !== null) {
        wakeLock.release().then(() => setWakeLock(null));
      }
    };
    requestWakeLock();
    
    return () => {
      if (wakeLock !== null) wakeLock.release().then(() => setWakeLock(null));
    };
  }, [isDetailModalOpen]);

  // --- AUTO LOGIN & FETCH (POCKETBASE) ---
  useEffect(() => {
    async function authenticateAndFetch() {
      setIsLoading(true);
      try {
        const email = window.HA_CONFIG.AUTO_LOGIN_EMAIL;
        const password = window.HA_CONFIG.AUTO_LOGIN_PASSWORD;
        await pb.collection('_superusers').authWithPassword(email, password, { requestKey: null });
        await fetchRecipes();
      } catch (error) {
        console.error("Auto-login failed:", error.message);
        alert("Login Failed. Check your PocketBase Superuser credentials in Home Assistant.");
        setIsLoading(false);
      }
    }
    authenticateAndFetch();
  }, []);

  async function fetchRecipes() {
    try {
      const records = await pb.collection('recipes').getFullList({ 
          sort: '-created',
          requestKey: null 
      });
      const mappedRecords = records.map(record => ({
        ...record,
        image_url: record.image ? pb.files.getURL(record, record.image) : ''
      }));
      setRecipes(mappedRecords);
    } catch (error) {
        console.error("Fetch error:", error);
    }
    setIsLoading(false);
  }

  // --- UNIQUE INGREDIENTS (Autocomplete) ---
  const suggestedIngredients = useMemo(() => {
    const allIngredients = new Set();
    recipes.forEach(recipe => {
      if (recipe.ingredients) {
        recipe.ingredients.forEach(ing => {
          if (ing.name && ing.name.trim() !== '') allIngredients.add(ing.name.trim().toLowerCase());
        });
      }
    });
    return Array.from(allIngredients).sort();
  }, [recipes]);

  // --- IMAGE SELECTION & COMPRESSION ---
  async function processSelectedImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setIsUploadingImage(true);
    try {
      const options = { maxSizeMB: 1, maxWidthOrHeight: 1200, useWebWorker: true };
      const compressedFile = await imageCompression(file, options);
      setImageFile(compressedFile);
      setManualRecipe(prev => ({ ...prev, image_url: URL.createObjectURL(compressedFile) }));
    } catch (error) {
      console.error("Image processing error:", error);
      alert("Failed to process image: " + error.message);
    } finally {
      setIsUploadingImage(false);
    }
  }

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (file) processSelectedImage(file);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processSelectedImage(file);
          break;
        }
      }
    }
  }

  function handleAIPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          setImportImage(file);
          break;
        }
      }
    }
  }

  // --- AI PARSING ---
  async function parseRecipeWithAI() {
    setIsParsing(true);
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash-lite",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING },
              summary: { type: SchemaType.STRING },
              prep_time_minutes: { type: SchemaType.INTEGER },
              cook_time_minutes: { type: SchemaType.INTEGER },
              servings: { type: SchemaType.INTEGER },
              ingredients: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { amount: { type: SchemaType.STRING }, unit: { type: SchemaType.STRING }, name: { type: SchemaType.STRING } } } },
              instructions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
            },
            required: ["title", "ingredients", "instructions"]
          }
        }
      });

      let promptArgs = [];
      const basePrompt = "Extract the recipe details into JSON. Extract exact times, servings, ingredients, and instructions.";

      if (aiInputMode === 'text') {
        if (!pasteText.trim()) throw new Error("Please enter recipe text.");
        promptArgs = [`${basePrompt}\n\nText:\n${pasteText}`];
      } else if (aiInputMode === 'url') {
        if (!importUrl.trim()) throw new Error("Please enter a URL.");
        const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(importUrl)}`);
        if (!response.ok) throw new Error("Failed to fetch the website URL.");
        const html = await response.text();
        promptArgs = [`${basePrompt} Find the main recipe hidden in this HTML code:\n\n${html}`];
      } else if (aiInputMode === 'image') {
        if (!importImage) throw new Error("Please upload an image.");
        const imagePart = await fileToGenerativePart(importImage);
        promptArgs = [`${basePrompt} Read the recipe from this uploaded image.`, imagePart];
      }

      let result;
      let retries = 3;
      while (retries > 0) {
        try {
          result = await model.generateContent(promptArgs);
          break;
        } catch (e) {
          if (e.message.includes("503") && retries > 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            retries--;
          } else {
            throw e;
          }
        }
      }

      const rawText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(rawText);

      const record = await pb.collection('recipes').create(parsedData);
      setRecipes([{ ...record, image_url: '' }, ...recipes]);
      closeAddModal();

    } catch (error) {
      console.error(error);
      alert(`Parsing failed: ${error.message}`);
    } finally {
      setIsParsing(false);
    }
  }

  // --- SAVE & EDIT LOGIC ---
  async function saveManualRecipe() {
    if (!manualRecipe.title) return alert("Title is required!");
    setIsSavingManual(true);
    
    try {
      const formData = new FormData();
      formData.append('title', manualRecipe.title);
      formData.append('summary', manualRecipe.summary || '');
      formData.append('prep_time_minutes', manualRecipe.prep_time_minutes || 0);
      formData.append('cook_time_minutes', manualRecipe.cook_time_minutes || 0);
      formData.append('servings', manualRecipe.servings || 1);
      
      const cleanedIngredients = manualRecipe.ingredients.filter(i => i.name.trim() !== '');
      const cleanedInstructions = manualRecipe.instructions.filter(i => i.trim() !== '');
      formData.append('ingredients', JSON.stringify(cleanedIngredients));
      formData.append('instructions', JSON.stringify(cleanedInstructions));
      
      if (imageFile) {
        formData.append('image', imageFile);
      } else if (manualRecipe.image_url === '') {
        formData.append('image', ''); 
      }

      let savedRecord;
      if (manualRecipe.id) {
        savedRecord = await pb.collection('recipes').update(manualRecipe.id, formData);
        savedRecord.image_url = savedRecord.image ? pb.files.getURL(savedRecord, savedRecord.image) : '';
        setRecipes(recipes.map(r => r.id === savedRecord.id ? savedRecord : r));
        closeAddModal();
        setSelectedRecipe(savedRecord);
        setIsDetailModalOpen(true);
      } else {
        savedRecord = await pb.collection('recipes').create(formData);
        savedRecord.image_url = savedRecord.image ? pb.files.getURL(savedRecord, savedRecord.image) : '';
        setRecipes([savedRecord, ...recipes]);
        closeAddModal();
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save recipe: " + error.message);
    } finally {
      setIsSavingManual(false);
    }
  }

  function startEditing(recipe) {
    setIsDetailModalOpen(false);
    setManualRecipe(recipe);
    setImageFile(null);
    setAddMode('manual');
    setIsAddModalOpen(true);
  }

  function closeAddModal() {
    setIsAddModalOpen(false);
    setPasteText('');
    setManualRecipe(emptyManualRecipe);
    setImageFile(null);
    setAddMode('ai');
  }

  async function deleteRecipe(id) {
    if (!confirm("Are you sure you want to permanently delete this recipe?")) return;
    try {
      await pb.collection('recipes').delete(id);
      setRecipes(recipes.filter(r => r.id !== id));
      setIsDetailModalOpen(false);
    } catch (error) {
      alert("Failed to delete recipe.");
    }
  }

  const filteredRecipes = recipes.filter(r => 
    r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="min-h-screen w-full transition-colors duration-200">
      <div className="max-w-6xl mx-auto p-6">
        
        {/* HEADER */}
        <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400">
            <ChefHat size={32} />
            <h1 className="text-3xl font-bold">Main Menu ;)</h1>
          </div>
          
          <div className="flex w-full md:w-auto gap-4 items-center">
            <div className="relative flex-1 md:w-80">
              <Search className="absolute left-3 top-3 text-gray-400" size={20} />
              <input 
                type="text" 
                placeholder="Search recipes..." 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
                className="w-full pl-10 pr-4 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none dark:bg-gray-800 dark:border-gray-700 dark:text-white transition-colors" 
              />
            </div>
            
            <button onClick={() => { setManualRecipe(emptyManualRecipe); setImageFile(null); setIsAddModalOpen(true); }} className="bg-emerald-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-emerald-700 transition">
              <Plus size={20} /> <span className="hidden md:inline">Add</span>
            </button>

            {/* Desktop Dark Mode Toggle */}
            <button onClick={() => setDarkMode(!darkMode)} className="hidden md:flex p-2 border rounded-xl hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 transition-colors" title="Toggle Dark Mode">
              {darkMode ? <Sun size={20} className="text-yellow-400" /> : <Moon size={20} className="text-gray-500" />}
            </button>
          </div>
        </header>

        {/* RECIPE GRID */}
        {isLoading ? (
          <div className="flex justify-center mt-20"><Loader2 className="animate-spin text-emerald-600" size={40} /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRecipes.map(recipe => (
              <div key={recipe.id} onClick={() => { setSelectedRecipe(recipe); setIsDetailModalOpen(true); setDetailTab('recipe'); }} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm hover:shadow-md transition cursor-pointer border dark:border-gray-700 overflow-hidden group">
                <div className="h-48 bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center overflow-hidden">
                  {recipe.image_url ? (
                    <img src={recipe.image_url} alt={recipe.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <ChefHat size={48} className="text-emerald-300 dark:text-emerald-700" />
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-bold text-xl mb-2 line-clamp-1 dark:text-white">{recipe.title}</h3>
                  <p className="text-gray-500 dark:text-gray-400 text-sm mb-4 line-clamp-2">{recipe.summary || 'No summary available.'}</p>
                  <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <span className="flex items-center gap-1"><Clock size={16}/> {recipe.prep_time_minutes + recipe.cook_time_minutes}m</span>
                    <span className="flex items-center gap-1"><Users size={16}/> {recipe.servings}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ADD / EDIT MODAL */}
        {isAddModalOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[100] overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 dark:text-white rounded-2xl p-6 w-full max-w-3xl my-8 border dark:border-gray-800 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{manualRecipe.id ? 'Edit Recipe' : 'Add Recipe'}</h2>
                <button onClick={closeAddModal} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition"><X className="text-gray-500" /></button>
              </div>

              {!manualRecipe.id && (
                <div className="flex gap-2 mb-6 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                  <button onClick={() => setAddMode('ai')} className={`flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition ${addMode === 'ai' ? 'bg-white dark:bg-gray-700 shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`}>
                    <Wand2 size={18} /> Auto AI
                  </button>
                  <button onClick={() => setAddMode('manual')} className={`flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition ${addMode === 'manual' ? 'bg-white dark:bg-gray-700 shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`}>
                    <PenLine size={18} /> Manual
                  </button>
                </div>
              )}

              {/* Add Modal Content (Unchanged functionality, updated styling for dark mode) */}
              {addMode === 'ai' && !manualRecipe.id && (
                <div className="animate-in fade-in duration-200 space-y-4">
                  <div className="flex gap-2 text-sm mb-2">
                    <button onClick={() => setAiInputMode('text')} className={`px-4 py-1 rounded-full ${aiInputMode === 'text' ? 'bg-emerald-100 text-emerald-700 font-bold dark:bg-emerald-900/40 dark:text-emerald-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>Paste Text</button>
                    <button onClick={() => setAiInputMode('url')} className={`px-4 py-1 rounded-full ${aiInputMode === 'url' ? 'bg-emerald-100 text-emerald-700 font-bold dark:bg-emerald-900/40 dark:text-emerald-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>From URL</button>
                    <button onClick={() => setAiInputMode('image')} className={`px-4 py-1 rounded-full ${aiInputMode === 'image' ? 'bg-emerald-100 text-emerald-700 font-bold dark:bg-emerald-900/40 dark:text-emerald-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>Upload Screenshot</button>
                  </div>

                  {aiInputMode === 'text' && (
                  <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste recipe text..." className="w-full h-48 border dark:border-gray-700 rounded-xl p-4 focus:ring-2 focus:ring-emerald-500 outline-none resize-none dark:bg-gray-800" />
                  )}

                  {aiInputMode === 'url' && (
                  <input type="url" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://www.recipeblog.com/..." className="w-full p-4 border dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none dark:bg-gray-800" />
                  )}

                  {aiInputMode === 'image' && (
                  <div tabIndex={0} onPaste={handleAIPaste} className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 focus:border-emerald-500 focus:outline-none cursor-pointer min-h-[160px]">
                      {importImage ? (
                      <div className="text-center">
                          <p className="text-emerald-600 dark:text-emerald-400 font-bold mb-2">📸 Selected: {importImage.name}</p>
                          <button onClick={() => setImportImage(null)} className="text-red-500 text-sm hover:underline font-bold">Remove Image</button>
                      </div>
                      ) : (
                      <div className="text-center">
                          <label className="cursor-pointer text-emerald-600 dark:text-emerald-400 font-bold hover:underline">
                          Click to select or press Ctrl+V to paste
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => setImportImage(e.target.files[0])} />
                          </label>
                          <p className="text-gray-400 text-sm mt-2">Paste a screenshot of a recipe page or cookbook</p>
                      </div>
                      )}
                  </div>
                  )}

                  <button onClick={parseRecipeWithAI} disabled={isParsing} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 flex justify-center items-center gap-2">
                  {isParsing ? <><Loader2 className="animate-spin" size={20} /> Extracting with Gemini...</> : 'Extract & Save with AI'}
                  </button>
                </div>
              )}

              {addMode === 'manual' && (
                <div className="space-y-6 animate-in fade-in duration-200 h-[60vh] overflow-y-auto pr-2 no-scrollbar">
                  <div tabIndex={0} onPaste={handlePaste} className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 flex flex-col items-center justify-center gap-3 relative overflow-hidden bg-gray-50 dark:bg-gray-800 focus:border-emerald-500 focus:outline-none cursor-pointer">
                    {manualRecipe.image_url ? (
                        <div className="relative w-full h-48 rounded-lg overflow-hidden group">
                        <img src={manualRecipe.image_url} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-4">
                            <label className="cursor-pointer bg-white text-gray-800 px-4 py-2 rounded-lg font-bold hover:bg-gray-100 flex items-center gap-2">
                            <Edit2 size={16} /> Change Image
                            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploadingImage} />
                            </label>
                            <button onClick={() => { setManualRecipe({...manualRecipe, image_url: ''}); setImageFile(null); }} className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-600 flex items-center gap-2">
                            <Trash2 size={16} /> Remove
                            </button>
                        </div>
                        </div>
                    ) : (
                        <>
                        <ImagePlus size={40} className="text-gray-400" />
                        <div className="text-center">
                            <label className="cursor-pointer text-emerald-600 dark:text-emerald-400 font-bold hover:underline">
                            Click to upload or press Ctrl+V to paste
                            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploadingImage} />
                            </label>
                            <p className="text-gray-400 text-sm mt-1">Images are compressed automatically</p>
                        </div>
                        {isUploadingImage && (
                            <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 flex items-center justify-center flex-col gap-2">
                            <Loader2 className="animate-spin text-emerald-600" size={32} />
                            <span className="font-bold">Compressing...</span>
                            </div>
                        )}
                        </>
                    )}
                  </div>
                  
                  <div className="space-y-4">
                    <input type="text" placeholder="Recipe Title *" value={manualRecipe.title} onChange={e => setManualRecipe({...manualRecipe, title: e.target.value})} className="w-full p-3 border dark:border-gray-700 rounded-xl font-bold text-lg focus:ring-2 focus:ring-emerald-500 outline-none dark:bg-gray-800" />
                    <textarea placeholder="Short Summary" value={manualRecipe.summary} onChange={e => setManualRecipe({...manualRecipe, summary: e.target.value})} className="w-full p-3 border dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none dark:bg-gray-800" rows="2" />
                    
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Prep (min)</label>
                        <input type="number" value={manualRecipe.prep_time_minutes || ''} onChange={e => setManualRecipe({...manualRecipe, prep_time_minutes: parseInt(e.target.value) || 0})} className="w-full p-3 border dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-gray-800" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Cook (min)</label>
                        <input type="number" value={manualRecipe.cook_time_minutes || ''} onChange={e => setManualRecipe({...manualRecipe, cook_time_minutes: parseInt(e.target.value) || 0})} className="w-full p-3 border dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-gray-800" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Servings</label>
                        <input type="number" value={manualRecipe.servings || ''} onChange={e => setManualRecipe({...manualRecipe, servings: parseInt(e.target.value) || 1})} className="w-full p-3 border dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-gray-800" />
                      </div>
                    </div>
                  </div>

                  <datalist id="ingredient-suggestions">
                    {suggestedIngredients.map((name, idx) => <option key={idx} value={name} />)}
                  </datalist>

                  <div>
                    <h3 className="font-bold mb-2 flex items-center justify-between">
                      Ingredients
                      <button onClick={() => setManualRecipe({...manualRecipe, ingredients: [...manualRecipe.ingredients, { amount: '', unit: '', name: '' }]})} className="text-emerald-600 dark:text-emerald-400 text-sm flex items-center gap-1 hover:underline"><Plus size={16}/> Add Row</button>
                    </h3>
                    <div className="space-y-2">
                      {manualRecipe.ingredients.map((ing, index) => (
                        <div key={index} className="flex gap-2">
                          <input type="text" placeholder="Amt" value={ing.amount} onChange={e => { const newIng = [...manualRecipe.ingredients]; newIng[index].amount = e.target.value; setManualRecipe({...manualRecipe, ingredients: newIng}); }} className="w-1/4 p-2 border dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-gray-800" />
                          <input type="text" placeholder="Unit" value={ing.unit} onChange={e => { const newIng = [...manualRecipe.ingredients]; newIng[index].unit = e.target.value; setManualRecipe({...manualRecipe, ingredients: newIng}); }} className="w-1/4 p-2 border dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-gray-800" />
                          <input type="text" list="ingredient-suggestions" placeholder="Ingredient *" value={ing.name} onChange={e => { const newIng = [...manualRecipe.ingredients]; newIng[index].name = e.target.value; setManualRecipe({...manualRecipe, ingredients: newIng}); }} className="flex-1 p-2 border dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-gray-800" />
                          <button onClick={() => { const newIng = manualRecipe.ingredients.filter((_, i) => i !== index); setManualRecipe({...manualRecipe, ingredients: newIng}); }} className="p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg"><Trash2 size={20}/></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold mb-2 flex items-center justify-between">
                      Instructions
                      <button onClick={() => setManualRecipe({...manualRecipe, instructions: [...manualRecipe.instructions, '']})} className="text-emerald-600 dark:text-emerald-400 text-sm flex items-center gap-1 hover:underline"><Plus size={16}/> Add Step</button>
                    </h3>
                    <div className="space-y-2">
                      {manualRecipe.instructions.map((step, index) => (
                        <div key={index} className="flex gap-2 items-start">
                          <span className="mt-2 text-gray-400 font-bold w-6">{index + 1}.</span>
                          <textarea placeholder="Instruction step..." value={step} onChange={e => { const newInst = [...manualRecipe.instructions]; newInst[index] = e.target.value; setManualRecipe({...manualRecipe, instructions: newInst}); }} className="flex-1 p-2 border dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 resize-none dark:bg-gray-800" rows="2" />
                          <button onClick={() => { const newInst = manualRecipe.instructions.filter((_, i) => i !== index); setManualRecipe({...manualRecipe, instructions: newInst}); }} className="p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg mt-1"><Trash2 size={20}/></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button onClick={saveManualRecipe} disabled={isSavingManual || !manualRecipe.title || isUploadingImage} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 flex justify-center items-center mt-4 sticky bottom-0 shadow-lg">
                    {isSavingManual ? <Loader2 className="animate-spin" size={20} /> : (manualRecipe.id ? 'Save Changes' : 'Save Recipe')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DETAIL MODAL (Redesigned for mobile overlap and tabs) */}
        {isDetailModalOpen && selectedRecipe && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-0 md:p-4">
            <div className="bg-white dark:bg-gray-900 w-full h-full md:h-auto md:max-h-[90vh] md:max-w-3xl md:rounded-2xl flex flex-col overflow-hidden relative">
              
              {/* Close Button Top Right (Floating) */}
              <button onClick={() => { setIsDetailModalOpen(false); setDetailTab('recipe'); }} className="absolute top-4 right-4 z-[110] p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition backdrop-blur-sm">
                <X size={24} />
              </button>

              <div className="overflow-y-auto flex-1 h-full relative no-scrollbar">
                
                {/* Sticky Header Image */}
                {selectedRecipe.image_url && (
                  <div className="h-72 md:h-80 w-full bg-black flex-shrink-0 sticky top-0 z-0">
                    <img src={selectedRecipe.image_url} alt={selectedRecipe.title} className="w-full h-full object-cover opacity-80" />
                  </div>
                )}

                {/* Overlapping Content Container */}
                <div className={`relative z-10 bg-white dark:bg-gray-900 ${selectedRecipe.image_url ? '-mt-16 pt-8 rounded-t-3xl md:-mt-0 md:rounded-t-none md:pt-6' : 'pt-16'} px-6 pb-0 border-b dark:border-gray-800 shadow-[0_-10px_20px_rgba(0,0,0,0.1)] md:shadow-none`}>
                  <h2 className="text-3xl font-bold dark:text-white">{selectedRecipe.title}</h2>
                  <div className="flex gap-4 mt-3 text-gray-600 dark:text-gray-400">
                    <span className="flex items-center gap-1"><Clock size={16}/> {selectedRecipe.prep_time_minutes + selectedRecipe.cook_time_minutes} min</span>
                    <span className="flex items-center gap-1"><Users size={16}/> {selectedRecipe.servings} servings</span>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-6 mt-6 border-b dark:border-gray-800">
                    <button onClick={() => setDetailTab('recipe')} className={`pb-3 font-bold transition-colors border-b-2 ${detailTab === 'recipe' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}>
                      Recipe
                    </button>
                    <button onClick={() => setDetailTab('manage')} className={`pb-3 font-bold transition-colors border-b-2 ${detailTab === 'manage' ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-300'}`}>
                      Manage
                    </button>
                  </div>
                </div>

                {/* Tab Content */}
                <div className="relative z-10 bg-white dark:bg-gray-900 min-h-[50vh]">
                  {detailTab === 'recipe' ? (
                    <div className="p-6 grid md:grid-cols-3 gap-8">
                      <div className="md:col-span-1">
                        <h3 className="font-bold text-xl mb-4 border-b dark:border-gray-800 pb-2 dark:text-white">Ingredients</h3>
                        <ul className="space-y-3">
                          {selectedRecipe.ingredients?.map((ing, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <input type="checkbox" className="mt-1 w-4 h-4 text-emerald-600 rounded" />
                              <span className="text-gray-700 dark:text-gray-300"><strong>{ing.amount} {ing.unit}</strong> {ing.name}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="md:col-span-2">
                        <h3 className="font-bold text-xl mb-4 border-b dark:border-gray-800 pb-2 dark:text-white">Instructions</h3>
                        <ol className="space-y-5">
                          {selectedRecipe.instructions?.map((step, i) => (
                            <li key={i} className="flex gap-4">
                              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold">{i + 1}</span>
                              <p className="text-gray-700 dark:text-gray-300 pt-1 leading-relaxed">{step}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 space-y-8 max-w-lg mx-auto text-center mt-4">
                      <div>
                        <h3 className="text-xl font-bold dark:text-white mb-2">Edit Recipe</h3>
                        <p className="text-gray-500 dark:text-gray-400 mb-5 text-sm">Update ingredients, tweak times, or change the recipe image.</p>
                        <button onClick={() => startEditing(selectedRecipe)} className="w-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition dark:bg-emerald-900/40 dark:text-emerald-400 dark:hover:bg-emerald-900/60">
                          <Edit2 size={18} /> Edit Details
                        </button>
                      </div>
                      <div className="pt-8 border-t dark:border-gray-800">
                        <h3 className="text-xl font-bold text-red-500 mb-2">Danger Zone</h3>
                        <p className="text-gray-500 dark:text-gray-400 mb-5 text-sm">Permanently delete this recipe. This action cannot be undone.</p>
                        <button onClick={() => deleteRecipe(selectedRecipe.id)} className="w-full bg-red-100 text-red-600 hover:bg-red-200 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50">
                          <Trash2 size={18} /> Delete Recipe
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}