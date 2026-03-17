import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { pdfStyles, type PDFData } from './base';

const styles = StyleSheet.create({
  ...pdfStyles,
  medicamentoItem: {
    marginBottom: 8,
    padding: 8,
    borderLeft: '2 solid #000',
    paddingLeft: 10,
  },
  medicamentoNome: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  medicamentoInfo: {
    fontSize: 12,
    marginBottom: 2,
  },
  qrCode: {
    width: 120,
    height: 120,
    marginTop: 8,
  },
});

interface PrescricaoPDFProps {
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
    qrCodeUrl?: string;
    qrCodeLabel?: string;
    certificadoDigital?: string;
    medicamentos?: Array<{
      nome: string;
      dosagem: string;
      frequencia: string;
      duracao: string;
      observacoes?: string;
    }>;
  };
}

export function PrescricaoPDFDocument({ data }: PrescricaoPDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {data.image1 && (
          <Image src={data.image1} style={styles.image} />
        )}
        
        {data.titulo && (
          <Text style={styles.header}>{data.titulo}</Text>
        )}

        {data.nomepaciente && (
          <Text style={styles.title}>Paciente: {data.nomepaciente}</Text>
        )}

        {data.data && (
          <Text style={styles.body}>Data: {data.data}</Text>
        )}

        <View style={styles.divider} />

        {data.medicamentos && data.medicamentos.length > 0 && (
          <View>
            <Text style={styles.subtitle}>Medicamentos Prescritos:</Text>
            {data.medicamentos.map((med, index) => (
              <View key={index} style={styles.medicamentoItem}>
                <Text style={styles.medicamentoNome}>{med.nome}</Text>
                <Text style={styles.medicamentoInfo}>Dosagem: {med.dosagem}</Text>
                <Text style={styles.medicamentoInfo}>Frequência: {med.frequencia}</Text>
                <Text style={styles.medicamentoInfo}>Duração: {med.duracao}</Text>
                {med.observacoes && (
                  <Text style={styles.medicamentoInfo}>Observações: {med.observacoes}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {data.descricao && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.body}>{data.descricao}</Text>
          </View>
        )}

        {data.certificadoDigital && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.subtitle}>Certificado Digital</Text>
            <Text style={styles.body}>{data.certificadoDigital}</Text>
          </View>
        )}

        {(data.qrCodeUrl || data.image2) && (
          <View style={{ marginTop: 16, alignItems: 'center' }}>
            <Text style={styles.subtitle}>QR Code - Baixar / Imprimir</Text>
            <Image src={data.qrCodeUrl || data.image2!} style={styles.qrCode} />
            {data.qrCodeLabel && (
              <Text style={[styles.body, { marginTop: 6 }]}>{data.qrCodeLabel}</Text>
            )}
          </View>
        )}

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.column}>
            {data.header2 && <Text style={styles.footer}>{data.header2}</Text>}
            {data.rodape1 && <Text style={styles.footer}>{data.rodape1}</Text>}
            {data.rodape2 && <Text style={styles.footer}>{data.rodape2}</Text>}
            {data.rodape3 && <Text style={styles.footer}>{data.rodape3}</Text>}
            {data.rodape4 && <Text style={styles.footer}>{data.rodape4}</Text>}
          </View>
          {data.image2 && (
            <Image src={data.image2} style={styles.image} />
          )}
        </View>
      </Page>
    </Document>
  );
}
