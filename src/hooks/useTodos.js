import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export function useTodos() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'todos'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        dueDate: doc.data().dueDate?.toDate?.() || null,
        createdAt: doc.data().createdAt?.toDate?.() || new Date(),
        updatedAt: doc.data().updatedAt?.toDate?.() || new Date(),
      }));
      setTodos(items);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const addTodo = async ({ title, categoryId = null, dueDate = null, timeEstimate = null }) => {
    return addDoc(collection(db, 'todos'), {
      title,
      categoryId,
      dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate)) : null,
      timeEstimate,
      done: false,
      calendarEventId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  };

  const updateTodo = async (id, data) => {
    const updateData = { ...data, updatedAt: serverTimestamp() };
    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? Timestamp.fromDate(new Date(data.dueDate)) : null;
    }
    return updateDoc(doc(db, 'todos', id), updateData);
  };

  const toggleDone = async (id) => {
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    return updateDoc(doc(db, 'todos', id), {
      done: !todo.done,
      updatedAt: serverTimestamp()
    });
  };

  const deleteTodo = async (id) => {
    return deleteDoc(doc(db, 'todos', id));
  };

  return { todos, loading, addTodo, updateTodo, toggleDone, deleteTodo };
}
