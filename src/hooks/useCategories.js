import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT_CATEGORIES = [
  { name: 'Transavia', keywords: ['transavia'], color: '#4A90D9', order: 0 },
  { name: 'Wehkamp', keywords: ['wehkamp'], color: '#E85D75', order: 1 },
  { name: 'Mantel', keywords: ['mantel'], color: '#50C878', order: 2 },
  { name: 'Keesing', keywords: ['keesing'], color: '#F5A623', order: 3 },
  { name: 'Maxeda', keywords: ['maxeda', 'praxis', 'brico'], color: '#9B59B6', order: 4 },
  { name: 'Intern', keywords: ['intern', 'onboarding', 'linkedin'], color: '#95A5A6', order: 5 },
];

export function useCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'categories'), orderBy('order'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCategories(cats);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const addCategory = async ({ name, keywords = [], color = '#95A5A6' }) => {
    const maxOrder = categories.length > 0 ? Math.max(...categories.map(c => c.order)) + 1 : 0;
    return addDoc(collection(db, 'categories'), {
      name,
      keywords: keywords.length > 0 ? keywords : [name.toLowerCase()],
      color,
      order: maxOrder,
      createdAt: serverTimestamp()
    });
  };

  const updateCategory = async (id, data) => {
    return updateDoc(doc(db, 'categories', id), data);
  };

  const deleteCategory = async (id) => {
    return deleteDoc(doc(db, 'categories', id));
  };

  const initializeDefaults = async () => {
    if (categories.length === 0 && !loading) {
      for (const cat of DEFAULT_CATEGORIES) {
        await addDoc(collection(db, 'categories'), {
          ...cat,
          createdAt: serverTimestamp()
        });
      }
    }
  };

  return { categories, loading, addCategory, updateCategory, deleteCategory, initializeDefaults };
}
