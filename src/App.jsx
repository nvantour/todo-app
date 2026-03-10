import { useState, useMemo, useEffect } from 'react';
import { HashRouter, Routes, Route, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTodos } from './hooks/useTodos';
import { useCategories } from './hooks/useCategories';
import LoginScreen from './components/Auth/LoginScreen';
import Sidebar from './components/Sidebar/Sidebar';
import Header from './components/Layout/Header';
import TaskListView from './components/TaskList/TaskListView';
import CategoryManager from './components/Categories/CategoryManager';
import AddTodoModal from './components/Todo/AddTodoModal';
import EditTodoModal from './components/Todo/EditTodoModal';
import ScheduleModal from './components/Calendar/ScheduleModal';
import QuickAddPage from './components/QuickAdd/QuickAddPage';
import './App.css';

function MainLayout() {
  const { user, loading: authLoading } = useAuth();
  const { todos, addTodo, updateTodo, toggleDone, deleteTodo } = useTodos();
  const { categories, loading: catsLoading, addCategory, updateCategory, deleteCategory, initializeDefaults } = useCategories();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState(null);
  const [schedulingTodo, setSchedulingTodo] = useState(null);

  useEffect(() => {
    if (user && !catsLoading && categories.length === 0) {
      initializeDefaults();
    }
  }, [user, catsLoading, categories.length]);

  const todoCounts = useMemo(() => {
    const openTodos = todos.filter(t => !t.done);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const byCategory = {};
    openTodos.forEach(t => {
      if (t.categoryId) {
        byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) + 1;
      }
    });

    return {
      all: openTodos.length,
      today: openTodos.filter(t => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        d.setHours(0, 0, 0, 0);
        return d.getTime() === today.getTime();
      }).length,
      upcoming: openTodos.filter(t => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        d.setHours(0, 0, 0, 0);
        return d >= today && d <= nextWeek;
      }).length,
      byCategory,
    };
  }, [todos]);

  const handleEventCreated = (todoId, calendarEventId) => {
    updateTodo(todoId, { calendarEventId });
  };

  const handleEventRemoved = (todoId) => {
    updateTodo(todoId, { calendarEventId: null });
  };

  const getCategory = (todo) => categories.find(c => c.id === todo?.categoryId);

  if (authLoading) {
    return <div className="app-loading">Laden...</div>;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="app">
      <Sidebar
        categories={categories}
        todoCounts={todoCounts}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="app-main">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Routes>
          <Route path="/" element={
            <TaskListView
              todos={todos}
              categories={categories}
              filter="all"
              onToggle={toggleDone}
              onEdit={setEditingTodo}
              onDelete={deleteTodo}
              onAddClick={() => setAddModalOpen(true)}
              onSchedule={setSchedulingTodo}
            />
          } />
          <Route path="/today" element={
            <TaskListView
              todos={todos}
              categories={categories}
              filter="today"
              onToggle={toggleDone}
              onEdit={setEditingTodo}
              onDelete={deleteTodo}
              onAddClick={() => setAddModalOpen(true)}
              onSchedule={setSchedulingTodo}
            />
          } />
          <Route path="/upcoming" element={
            <TaskListView
              todos={todos}
              categories={categories}
              filter="upcoming"
              onToggle={toggleDone}
              onEdit={setEditingTodo}
              onDelete={deleteTodo}
              onAddClick={() => setAddModalOpen(true)}
              onSchedule={setSchedulingTodo}
            />
          } />
          <Route path="/category/:categoryId" element={
            <CategoryFilterView
              todos={todos}
              categories={categories}
              onToggle={toggleDone}
              onEdit={setEditingTodo}
              onDelete={deleteTodo}
              onAddClick={() => setAddModalOpen(true)}
              onSchedule={setSchedulingTodo}
            />
          } />
          <Route path="/categories" element={
            <CategoryManager
              categories={categories}
              onAdd={addCategory}
              onUpdate={updateCategory}
              onDelete={deleteCategory}
            />
          } />
        </Routes>
      </div>

      <AddTodoModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSave={addTodo}
        categories={categories}
      />

      <EditTodoModal
        todo={editingTodo}
        isOpen={!!editingTodo}
        onClose={() => setEditingTodo(null)}
        onSave={updateTodo}
        onDelete={deleteTodo}
        onSchedule={setSchedulingTodo}
        categories={categories}
      />

      <ScheduleModal
        todo={schedulingTodo}
        isOpen={!!schedulingTodo}
        onClose={() => setSchedulingTodo(null)}
        onEventCreated={handleEventCreated}
        onEventRemoved={handleEventRemoved}
        category={getCategory(schedulingTodo)}
      />
    </div>
  );
}

function CategoryFilterView({ todos, categories, onToggle, onEdit, onDelete, onAddClick, onSchedule }) {
  const { categoryId } = useParams();
  const filteredTodos = todos.filter(t => t.categoryId === categoryId);
  const category = categories.find(c => c.id === categoryId);

  return (
    <TaskListView
      todos={filteredTodos}
      categories={category ? [category] : []}
      filter="category"
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
      onAddClick={onAddClick}
      onSchedule={onSchedule}
    />
  );
}

function AppContent() {
  return (
    <Routes>
      <Route path="/quick-add" element={<QuickAddPage />} />
      <Route path="/*" element={<MainLayout />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </HashRouter>
  );
}
