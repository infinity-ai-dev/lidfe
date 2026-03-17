import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { STORAGE_KEYS } from '@/utils/constants';

interface AppState {
  // Estado do app
  nomepaciente: string;
  datadiagnostico: string;
  cpfpaciente: string;
  listaexames: string;
  image1: string;
  image2: string;
  titulo: string;
  qrCodeData: string;
  openAIResponse: string;
  urlpdfguiaexame: string;
  pdfUrl: string;
  threadID: string;
  descricaoGuia: string;
  urlimageavatar: string;
  usermasculino: string;
  userfeminino: string;
  idthreadConversa: string;
  prescricaofinal: string;
  showArchived: boolean;
  
  // Actions
  setNomepaciente: (value: string) => void;
  setDatadiagnostico: (value: string) => void;
  setCpfpaciente: (value: string) => void;
  setListaexames: (value: string) => void;
  setImage1: (value: string) => void;
  setImage2: (value: string) => void;
  setTitulo: (value: string) => void;
  setQrCodeData: (value: string) => void;
  setOpenAIResponse: (value: string) => void;
  setUrlpdfguiaexame: (value: string) => void;
  setPdfUrl: (value: string) => void;
  setThreadID: (value: string) => void;
  setDescricaoGuia: (value: string) => void;
  setUrlimageavatar: (value: string) => void;
  setUsermasculino: (value: string) => void;
  setUserfeminino: (value: string) => void;
  setIdthreadConversa: (value: string) => void;
  setPrescricaofinal: (value: string) => void;
  setShowArchived: (value: boolean) => void;
  reset: () => void;
}

const defaultBioDigitalMasculino = '<iframe id="embedded-human" frameBorder="0" style="aspect-ratio: 1 / 1; width: 100%" allowFullScreen="true" loading="lazy" src="https://human.biodigital.com/viewer/?id=60SE&ui-anatomy-descriptions=true&ui-anatomy-pronunciations=true&ui-anatomy-labels=true&ui-audio=true&ui-chapter-list=false&ui-fullscreen=true&ui-help=true&ui-info=true&ui-label-list=true&ui-layers=true&ui-skin-layers=true&ui-loader=circle&ui-media-controls=full&ui-menu=true&ui-nav=true&ui-search=true&ui-tools=true&ui-tutorial=false&ui-undo=true&ui-whiteboard=true&initial.none=true&disable-scroll=false&uaid=M1KXP&paid=o_2c722c3d"></iframe>';

const defaultBioDigitalFeminino = '<iframe id="embedded-human" frameBorder="0" style="aspect-ratio: 1 / 1; width: 100%" allowFullScreen="true" loading="lazy" src="https://human.biodigital.com/viewer/?id=60SJ&ui-anatomy-descriptions=true&ui-anatomy-pronunciations=true&ui-anatomy-labels=true&ui-audio=true&ui-chapter-list=false&ui-fullscreen=true&ui-help=true&ui-info=true&ui-label-list=true&ui-layers=true&ui-skin-layers=true&ui-loader=circle&ui-media-controls=full&ui-menu=true&ui-nav=true&ui-search=true&ui-tools=true&ui-tutorial=false&ui-undo=true&ui-whiteboard=true&initial.none=true&disable-scroll=false&uaid=M1KXg&paid=o_2c722c3d"></iframe>';

const initialState = {
  nomepaciente: '',
  datadiagnostico: '',
  cpfpaciente: '',
  listaexames: '',
  image1: '',
  image2: '',
  titulo: '',
  qrCodeData: 'https://lidfe.mayacrm.shop/consulta',
  openAIResponse: '',
  urlpdfguiaexame: '',
  pdfUrl: '',
  threadID: '',
  descricaoGuia: '',
  urlimageavatar: '',
  usermasculino: defaultBioDigitalMasculino,
  userfeminino: defaultBioDigitalFeminino,
  idthreadConversa: '',
  prescricaofinal: '',
  showArchived: false,
};

// Persistência:
// - Web: localStorage (expo-secure-store não existe no browser)
// - Native: expo-secure-store
const secureStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      if (Platform.OS === 'web') {
        return window.localStorage.getItem(name);
      }
      return await SecureStore.getItemAsync(name);
    } catch (error) {
      console.error('Error getting secure storage:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      if (Platform.OS === 'web') {
        window.localStorage.setItem(name, value);
        return;
      }
      await SecureStore.setItemAsync(name, value);
    } catch (error) {
      console.error('Error setting secure storage:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      if (Platform.OS === 'web') {
        window.localStorage.removeItem(name);
        return;
      }
      await SecureStore.deleteItemAsync(name);
    } catch (error) {
      console.error('Error removing secure storage:', error);
    }
  },
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...initialState,
      
      setNomepaciente: (value) => set({ nomepaciente: value }),
      setDatadiagnostico: (value) => set({ datadiagnostico: value }),
      setCpfpaciente: (value) => set({ cpfpaciente: value }),
      setListaexames: (value) => set({ listaexames: value }),
      setImage1: (value) => set({ image1: value }),
      setImage2: (value) => set({ image2: value }),
      setTitulo: (value) => set({ titulo: value }),
      setQrCodeData: (value) => set({ qrCodeData: value }),
      setOpenAIResponse: (value) => set({ openAIResponse: value }),
      setUrlpdfguiaexame: (value) => set({ urlpdfguiaexame: value }),
      setPdfUrl: (value) => set({ pdfUrl: value }),
      setThreadID: (value) => set({ threadID: value }),
      setDescricaoGuia: (value) => set({ descricaoGuia: value }),
      setUrlimageavatar: (value) => set({ urlimageavatar: value }),
      setUsermasculino: (value) => set({ usermasculino: value }),
      setUserfeminino: (value) => set({ userfeminino: value }),
      setIdthreadConversa: (value) => set({ idthreadConversa: value }),
      setPrescricaofinal: (value) => set({ prescricaofinal: value }),
      setShowArchived: (value) => set({ showArchived: value }),
      reset: () => set(initialState),
    }),
    {
      name: 'app-storage',
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({
        qrCodeData: state.qrCodeData,
        urlimageavatar: state.urlimageavatar,
        usermasculino: state.usermasculino,
        userfeminino: state.userfeminino,
        idthreadConversa: state.idthreadConversa,
        prescricaofinal: state.prescricaofinal,
      }),
    }
  )
);
