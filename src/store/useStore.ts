'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AuthUser, LoginCredentials, SignupData } from '@/types';
import { DEFAULT_CURRENCY, DEFAULT_ACCENT_COLOR } from '@/lib/constants';
import { Language } from '@/lib/translations';
import { supabase } from '@/lib/supabaseClient';
import { useAuthStore } from '@/store/authStore';

export type Theme = 'light' | 'dark';

interface AppState {
  // Authentication
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;
  signup: (data: SignupData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateUserProfile: (data: { name?: string; phone?: string }) => Promise<{ success: boolean; error?: string }>;

  // Display currency (UI preference only; money records carry their own currency)
  currency: string;
  setCurrency: (currency: string) => void;

  // Language
  language: Language;
  setLanguage: (language: Language) => void;

  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // Accent Color
  accentColor: string;
  setAccentColor: (color: string) => void;

  // User
  userName: string;
  setUserName: (name: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Authentication
      user: null,
      isAuthenticated: false,

      login: async (credentials) => {
        try {
          // Sign in with Supabase Auth
          const { data, error } = await supabase.auth.signInWithPassword({
            email: credentials.email,
            password: credentials.password,
          });

          if (error) {
            // Provide user-friendly messages for common Supabase errors
            const msg = error.message?.toLowerCase() || '';
            if (msg.includes('email not confirmed')) {
              return {
                success: false,
                error: 'This account has not been confirmed. Please try signing up again with the same email.',
              };
            }
            if (msg.includes('invalid login credentials')) {
              return {
                success: false,
                error: 'Incorrect email or password. Please try again.',
              };
            }
            return { success: false, error: error.message };
          }

          if (!data.user || !data.session) {
            return { success: false, error: 'Login failed. Please try again.' };
          }

          const authUser: AuthUser = {
            id: data.user.id,
            email: data.user.email || '',
            name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || '',
            phone: data.user.user_metadata?.phone || '',
          };

          // Sync both stores so CRM guards see the user immediately
          useAuthStore.getState().setSession(data.session);
          if (!useAuthStore.getState().initialized) {
            useAuthStore.getState().setInitialized(true);
          }

          set({
            user: authUser,
            isAuthenticated: true,
            userName: authUser.name,
          });

          return { success: true };
        } catch (error) {
          return { success: false, error: 'Login failed. Please try again.' };
        }
      },

      signup: async (data) => {
        try {
          // Validate password length
          if (data.password.length < 6) {
            return { success: false, error: 'Password must be at least 6 characters' };
          }

          // Sign up with Supabase Auth
          const { data: signUpData, error } = await supabase.auth.signUp({
            email: data.email,
            password: data.password,
            options: {
              data: {
                name: data.name,
              },
            },
          });

          if (error) {
            return { success: false, error: error.message };
          }

          if (!signUpData.user) {
            return { success: false, error: 'Signup failed. Please try again.' };
          }

          // Determine the active session.
          // signUp may return a session directly (confirmation disabled) or null.
          // If null, try signing in — this handles edge cases like
          // re-registering an existing unconfirmed user after confirmation was disabled.
          let activeSession = signUpData.session;

          if (!activeSession) {
            const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
              email: data.email,
              password: data.password,
            });

            if (loginError || !loginData.session) {
              // Provide a helpful, non-misleading error
              const msg = loginError?.message?.toLowerCase().includes('email not confirmed')
                ? 'Your email has not been confirmed. Please check your inbox or contact support.'
                : 'Account created but automatic sign-in failed. Please try logging in manually.';
              return { success: false, error: msg };
            }

            activeSession = loginData.session;
          }

          // Sync both stores so CRM guards see the user immediately
          useAuthStore.getState().setSession(activeSession);
          if (!useAuthStore.getState().initialized) {
            useAuthStore.getState().setInitialized(true);
          }

          const authUser: AuthUser = {
            id: activeSession.user.id,
            email: activeSession.user.email || '',
            name: data.name,
          };

          set({
            user: authUser,
            isAuthenticated: true,
            userName: data.name,
          });

          return { success: true };
        } catch (error) {
          return { success: false, error: 'Signup failed. Please try again.' };
        }
      },

      logout: async () => {
        // Sign out from Supabase
        await supabase.auth.signOut();
        
        // Clear authStore so CRM guards see no user
        useAuthStore.getState().setSession(null);

        set({
          user: null,
          isAuthenticated: false,
          userName: '',
        });
      },

      updateUserProfile: async (data) => {
        try {
          const currentUser = get().user;
          if (!currentUser) {
            return { success: false, error: 'Not authenticated' };
          }

          // Update Supabase user metadata
          const { error } = await supabase.auth.updateUser({
            data: {
              name: data.name ?? currentUser.name,
              phone: data.phone ?? currentUser.phone,
            },
          });

          if (error) {
            return { success: false, error: error.message };
          }

          // Update local state
          const updatedUser: AuthUser = {
            ...currentUser,
            name: data.name ?? currentUser.name,
            phone: data.phone ?? currentUser.phone,
          };

          set({
            user: updatedUser,
            userName: updatedUser.name,
          });

          return { success: true };
        } catch (error) {
          return { success: false, error: 'Failed to update profile' };
        }
      },

      // Settings
      currency: DEFAULT_CURRENCY,
      setCurrency: (currency) => set({ currency }),

      // Language
      language: 'ar',
      setLanguage: (language) => set({ language }),

      // Theme
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),

      // Accent Color
      accentColor: DEFAULT_ACCENT_COLOR,
      setAccentColor: (color) => set({ accentColor: color }),

      // User
      userName: '',
      setUserName: (name) => set({ userName: name }),
    }),
    {
      name: 'rasmalak-storage',
      // Version 1 made dark the default; earlier saved states carried light only as the old default.
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        return (version < 1 ? { ...state, theme: 'dark' } : state) as never;
      },
      partialize: (state) => ({
        currency: state.currency,
        language: state.language,
        theme: state.theme,
        accentColor: state.accentColor,
      }),
    }
  )
);

// Selector hooks for better performance
export const useCurrency = () => useStore((state) => state.currency);
export const useUserName = () => useStore((state) => state.userName);
export const useLanguage = () => useStore((state) => state.language);
export const useTheme = () => useStore((state) => state.theme);
export const useAccentColor = () => useStore((state) => state.accentColor);

// Auth selectors are split to avoid SSR hydration issues.
export const useUser = () => useStore((state) => state.user);
export const useIsAuthenticated = () => useStore((state) => state.isAuthenticated);
export const useLogin = () => useStore((state) => state.login);
export const useSignup = () => useStore((state) => state.signup);
export const useLogout = () => useStore((state) => state.logout);
export const useUpdateUserProfile = () => useStore((state) => state.updateUserProfile);
