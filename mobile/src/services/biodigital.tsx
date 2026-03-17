import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from 'react-native-paper';

export interface BioDigitalViewerProps {
  gender: 'masculino' | 'feminino';
  style?: any;
}

// URLs dos visualizadores BioDigital
const BIODIGITAL_URLS = {
  masculino: 'https://human.biodigital.com/viewer/?id=60SE&ui-anatomy-descriptions=true&ui-anatomy-pronunciations=true&ui-anatomy-labels=true&ui-audio=true&ui-chapter-list=false&ui-fullscreen=true&ui-help=true&ui-info=true&ui-label-list=true&ui-layers=true&ui-skin-layers=true&ui-loader=circle&ui-media-controls=full&ui-menu=true&ui-nav=true&ui-search=true&ui-tools=true&ui-tutorial=false&ui-undo=true&ui-whiteboard=true&initial.none=true&disable-scroll=false&uaid=M1KXP&paid=o_2c722c3d',
  feminino: 'https://human.biodigital.com/viewer/?id=60SJ&ui-anatomy-descriptions=true&ui-anatomy-pronunciations=true&ui-anatomy-labels=true&ui-audio=true&ui-chapter-list=false&ui-fullscreen=true&ui-help=true&ui-info=true&ui-label-list=true&ui-layers=true&ui-skin-layers=true&ui-loader=circle&ui-media-controls=full&ui-menu=true&ui-nav=true&ui-search=true&ui-tools=true&ui-tutorial=false&ui-undo=true&ui-whiteboard=true&initial.none=true&disable-scroll=false&uaid=M1KXg&paid=o_2c722c3d',
};

export function BioDigitalViewer({ gender, style }: BioDigitalViewerProps) {
  const theme = useTheme();
  const url = BIODIGITAL_URLS[gender];

  return (
    <View style={[styles.container, style, { backgroundColor: theme.colors.background }]}>
      <WebView
        source={{ uri: url }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    aspectRatio: 1,
    width: '100%',
  },
  webview: {
    flex: 1,
  },
});

export const biodigitalService = {
  getUrl(gender: 'masculino' | 'feminino'): string {
    return BIODIGITAL_URLS[gender];
  },
};

export default biodigitalService;
