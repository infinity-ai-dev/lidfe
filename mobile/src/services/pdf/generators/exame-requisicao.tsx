import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { pdfStyles, type PDFData } from './base';

interface ExameRequisicaoPDFProps {
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
    titulo1?: string;
    titulo2?: string;
    titulo3?: string;
    titulo4?: string;
    titulo5?: string;
    titulo6?: string;
    titulo7?: string;
    titulo8?: string;
    titulo9?: string;
  };
}

export function ExameRequisicaoPDFDocument({ data }: ExameRequisicaoPDFProps) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        {data.titulo && (
          <Text style={[pdfStyles.header, { fontSize: 15, textAlign: 'center' }]}>
            {data.titulo}
          </Text>
        )}

        <View style={{ marginTop: 5 }}>
          {data.titulo1 && <Text style={{ fontSize: 10 }}>{data.titulo1}</Text>}
          {data.titulo2 && <Text style={{ fontSize: 10 }}>{data.titulo2}</Text>}
          {data.titulo3 && <Text style={{ fontSize: 10 }}>{data.titulo3}</Text>}
          {data.titulo4 && <Text style={{ fontSize: 10 }}>{data.titulo4}</Text>}
          {data.titulo5 && <Text style={{ fontSize: 10 }}>{data.titulo5}</Text>}
          {data.titulo6 && <Text style={{ fontSize: 10 }}>{data.titulo6}</Text>}
          {data.titulo7 && <Text style={{ fontSize: 10 }}>{data.titulo7}</Text>}
          {data.titulo8 && <Text style={{ fontSize: 10 }}>{data.titulo8}</Text>}
          {data.titulo9 && <Text style={{ fontSize: 10 }}>{data.titulo9}</Text>}
          {data.nomepaciente && (
            <Text style={{ fontSize: 10, marginTop: 5 }}>{data.nomepaciente}</Text>
          )}
        </View>

        <View style={pdfStyles.divider} />

        {data.descricao && (
          <Text style={pdfStyles.body}>{data.descricao}</Text>
        )}

        <View style={{ marginTop: 50 }}>
          <View style={pdfStyles.divider} />
        </View>

        {data.data && (
          <Text style={pdfStyles.body}>{data.data}</Text>
        )}

        <View style={{ marginTop: 20 }}>
          <View style={pdfStyles.row}>
            <View style={pdfStyles.column}>
              {data.header2 && <Text style={pdfStyles.footer}>{data.header2}</Text>}
              {data.rodape1 && <Text style={pdfStyles.footer}>{data.rodape1}</Text>}
              {data.rodape2 && <Text style={pdfStyles.footer}>{data.rodape2}</Text>}
              {data.rodape3 && <Text style={pdfStyles.footer}>{data.rodape3}</Text>}
              {data.rodape4 && <Text style={pdfStyles.footer}>{data.rodape4}</Text>}
            </View>
            {data.image2 && (
              <Image src={data.image2} style={pdfStyles.image} />
            )}
          </View>
        </View>
      </Page>
    </Document>
  );
}
