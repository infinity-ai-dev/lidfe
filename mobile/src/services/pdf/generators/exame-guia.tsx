import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

interface ExameGuiaPDFProps {
  data: {
    titulo?: string;
    nomepaciente?: string;
    descricao?: string;
    data?: string;
    header2?: string;
    image1?: string;
    image2?: string;
    rodape1?: string;
    rodape2?: string;
    rodape3?: string;
    rodape4?: string;
  };
}

export function ExameGuiaPDFDocument({ data }: ExameGuiaPDFProps) {
  const title = data.titulo || 'Guia de Exames';
  const signatureLines = [data.rodape1, data.rodape2, data.rodape3, data.rodape4].filter(Boolean) as string[];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {data.image1 && <Image src={data.image1} style={styles.logo} />}
          <Text style={styles.headerTitle}>{title}</Text>
        </View>

        {data.nomepaciente && <Text style={styles.infoLine}>{data.nomepaciente}</Text>}
        {data.data && <Text style={styles.infoLine}>{data.data}</Text>}

        {data.descricao && <Text style={styles.body}>{data.descricao}</Text>}

        {/* Large download/print QR in body area */}
        {data.image2 && (
          <View style={styles.downloadQrContainer}>
            <Text style={styles.downloadQrTitle}>Escaneie para baixar e imprimir</Text>
            <Image src={data.image2} style={styles.downloadQrImage} />
            <Text style={styles.downloadQrSub}>Para impressão do PDF</Text>
          </View>
        )}

        <View style={styles.footer}>
          <View style={styles.signatureBlock}>
            {signatureLines.map((line, index) => (
              <Text key={`${index}-${line}`} style={styles.signatureLine}>
                {line}
              </Text>
            ))}
          </View>
        </View>
      </Page>
    </Document>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 36,
    paddingBottom: 110,
    fontSize: 9,
    fontFamily: 'Times-Roman',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  logo: {
    width: 90,
    height: 36,
    marginRight: 12,
    objectFit: 'contain',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 'bold',
  },
  infoLine: {
    fontSize: 9,
    marginBottom: 2,
  },
  body: {
    fontSize: 9,
    lineHeight: 1.3,
    marginTop: 6,
  },
  footer: {
    position: 'absolute',
    left: 36,
    right: 36,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  signatureBlock: {
    width: '68%',
  },
  signatureLine: {
    fontSize: 7,
    marginBottom: 1,
  },
  qrBlock: {
    width: 80,
    alignItems: 'center',
  },
  qrLabel: {
    fontSize: 6,
    marginBottom: 3,
  },
  qrImage: {
    width: 70,
    height: 70,
    objectFit: 'contain',
  },
  qrPlaceholder: {
    width: 70,
    height: 70,
    borderWidth: 1,
    borderColor: '#999',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrPlaceholderText: {
    fontSize: 8,
    color: '#666',
  },
  downloadQrContainer: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 10,
  },
  downloadQrTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    marginBottom: 6,
    color: '#111',
  },
  downloadQrImage: {
    width: 140,
    height: 140,
    objectFit: 'contain',
  },
  downloadQrSub: {
    fontSize: 6,
    marginTop: 4,
    color: '#666',
  },
});
