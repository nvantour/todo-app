import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, reauthenticateWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = result._tokenResponse;
    if (credential?.oauthAccessToken) {
      setAccessToken(credential.oauthAccessToken);
    }
    return result.user;
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setAccessToken(null);
  };

  const refreshAccessToken = async () => {
    if (!user) return null;
    const result = await reauthenticateWithPopup(user, googleProvider);
    const credential = result._tokenResponse;
    if (credential?.oauthAccessToken) {
      setAccessToken(credential.oauthAccessToken);
      return credential.oauthAccessToken;
    }
    return null;
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, signIn, signOut, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
