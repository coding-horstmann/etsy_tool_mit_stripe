
'use server';

import Papa from 'papaparse';
import { z } from 'zod';
import type { UserInfo } from '@/lib/pdf-generator';

const invoiceItemSchema = z.object({
  quantity: z.number(),
  name: z.string(),
  netAmount: z.number(),
  vatRate: z.number(),
  vatAmount: z.number(),
  grossAmount: z.number(),
});

const invoiceSchema = z.object({
  id: z.string(), // Add a unique ID for each invoice for state management
  invoiceNumber: z.string(),
  orderDate: z.string(),
  serviceDate: z.string(),
  buyerName: z.string(),
  etsyCustomerName: z.string().optional(),
  buyerAddress: z.string(),
  items: z.array(invoiceItemSchema),
  netTotal: z.number(),
  vatTotal: z.number(),
  grossTotal: z.number(),
  taxNote: z.string(),
  country: z.string(),
  countryClassification: z.enum(['Deutschland', 'EU-Ausland', 'Drittland']),
});

const summarySchema = z.object({
  totalNetSales: z.number(),
  totalVat: z.number(),
});

const processCsvOutputSchema = z.object({
  invoices: z.array(invoiceSchema),
  summary: summarySchema,
});

export type Invoice = z.infer<typeof invoiceSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type ProcessCsvOutput = z.infer<typeof processCsvOutputSchema>;

export type BankTransaction = {
    date: string;
    description: string;
    amount: number;
}

const EU_COUNTRIES = new Set([
  'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech republic', 
  'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 
  'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 
  'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 
  'spain', 'sweden',
  'österreich', 'belgien', 'bulgarien', 'kroatien', 'zypern', 'tschechische republik',
  'dänemark', 'estland', 'finnland', 'frankreich', 'deutschland', 'griechenland', 'ungarn',
  'irland', 'italien', 'lettland', 'litauen', 'luxemburg', 'malta',
  'niederlande', 'polen', 'portugal', 'rumänien', 'slowakei', 'slowenien',
  'spanien', 'schweden'
]);

function normalizeString(str: string | null | undefined): string {
    if (!str) return '';
    return str.toLowerCase().trim();
}

function getCountryClassification(countryName: string): Invoice['countryClassification'] {
    const normalizedName = normalizeString(countryName);
    if (!normalizedName) return 'Drittland';

    if (normalizedName === 'germany' || normalizedName === 'deutschland') {
        return 'Deutschland';
    }
    if (EU_COUNTRIES.has(normalizedName)) {
        return 'EU-Ausland';
    }
    return 'Drittland';
}

function getTaxInfo(
    classification: Invoice['countryClassification'], 
    vatPaidByBuyer: boolean,
    taxStatus: UserInfo['taxStatus']
): { vatRate: number; taxNote: string; } {
    
    // Fall A: Sie sind Kleinunternehmer.
    if (taxStatus === 'small_business') {
        return {
            vatRate: 0,
            taxNote: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet."
        };
    }

    // Fall B: Sie sind umsatzsteuerpflichtig.
    // B.1: Lieferung in ein Drittland?
    if (classification === 'Drittland') {
        return {
            vatRate: 0,
            taxNote: "Steuerfreie Ausfuhrlieferung in ein Drittland."
        };
    }

    // B.2: Lieferung innerhalb der EU (inkl. Deutschland)?
    if (classification === 'Deutschland' || classification === 'EU-Ausland') {
        // B.2.a: Steht dort ein Wert > 0? (Indikator für digitales Produkt / Etsy führt USt ab)
        if (vatPaidByBuyer) {
             return {
                vatRate: 0,
                taxNote: "Umsatzsteuer wird von Etsy im Rahmen des One-Stop-Shop-Verfahrens abgeführt."
            };
        }
        // B.2.b: Ist die Spalte leer oder 0? (Indikator für physisches Produkt)
        return { vatRate: 19, taxNote: "Enthält 19% deutsche USt." };
    }

    // Fallback (sollte nicht erreicht werden, aber sichert den Standardfall ab)
    return { vatRate: 19, taxNote: "Enthält 19% deutsche USt." };
}

function parseFloatSafe(value: string | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const cleanedValue = value.trim().replace(/\s/g, '').replace(/"/g, '');
        const lastComma = cleanedValue.lastIndexOf(',');
        const lastDot = cleanedValue.lastIndexOf('.');

        if (lastComma > lastDot) {
            const parsableValue = cleanedValue.replace(/\./g, '').replace(',', '.');
            const parsed = parseFloat(parsableValue);
            return isNaN(parsed) ? 0 : parsed;
        }
        const parsableValue = cleanedValue.replace(/,/g, '');
        const parsed = parseFloat(parsableValue);
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}

const normalizeKey = (key: string) => key.toLowerCase().replace(/\s+/g, '');

function getColumn(row: any, potentialNames: string[], normalizedKeys: { [key: string]: string }): string {
    for (const name of potentialNames) {
        const normalizedName = normalizeKey(name);
        const actualKey = normalizedKeys[normalizedName];
        if (actualKey && row[actualKey] !== undefined && row[actualKey] !== null) {
            const value = String(row[actualKey]).trim();
            if (value !== '') {
                return value;
            }
        }
    }
    return '';
}

function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.match(/(\d+)/g);
    let date: Date;
    if (parts && parts.length === 3) {
      // Assuming MM/DD/YY or similar, which is common in Etsy CSVs
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      let year = parseInt(parts[2], 10);
      if (year < 100) {
        year += 2000; // E.g., '24' becomes '2024'
      }
      date = new Date(year, month - 1, day);
    } else {
      date = new Date(dateStr);
    }
    
    if (isNaN(date.getTime())) return dateStr;
    
    return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

export async function generateInvoicesAction(
    csvData: string, 
    taxStatus: UserInfo['taxStatus'],
    existingInvoices: Invoice[]
): Promise<{ data: ProcessCsvOutput | null; error: string | null; }> {
  try {
    const parseResult = Papa.parse(csvData, {
      header: true,
      skipEmptyLines: true,
      transformHeader: header => header.trim(),
    });

    if (parseResult.errors.length > 0) {
        console.error("CSV Parsing Errors:", parseResult.errors);
        return { data: null, error: `Fehler beim Parsen der CSV-Datei: ${parseResult.errors[0].message}` };
    }

    const normalizedHeaderMap: { [key: string]: string } = {};
    if (parseResult.meta.fields) {
        for (const field of parseResult.meta.fields) {
            normalizedHeaderMap[normalizeKey(field)] = field;
        }
    }

    // Duplikaterkennung über Fingerprint existierender Rechnungen (robust gegen DB-IDs)
    const normalizeAddress = (addr?: string) => (addr || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizeText = (t?: string) => (t || '').trim().toLowerCase();
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const makeFingerprint = (inv: Invoice) => {
      const items = [...(inv.items || [])].map((it: any) => ({
        name: normalizeText(it.name),
        quantity: Number(it.quantity || 0),
        netAmount: round2(Number(it.netAmount || 0)),
        vatRate: round2(Number(it.vatRate || 0)),
      })).sort((a, b) => a.name.localeCompare(b.name) || a.netAmount - b.netAmount || a.vatRate - b.vatRate || a.quantity - b.quantity);
      return JSON.stringify({
        bn: normalizeText(inv.buyerName),
        ba: normalizeAddress(inv.buyerAddress),
        od: inv.orderDate,
        sd: inv.serviceDate,
        nt: round2(inv.netTotal),
        vt: round2(inv.vatTotal),
        gt: round2(inv.grossTotal),
        items,
      });
    };
    const existingFingerprints = new Set<string>((existingInvoices || []).map((inv) => makeFingerprint(inv)));

    const rowsByOrderId = new Map<string, any[]>();
    for (const row of parseResult.data as any[]) {
      const orderId = getColumn(row, ['order id', 'bestellnummer', 'sale id'], normalizedHeaderMap);
      if (!orderId) continue;
      if (!rowsByOrderId.has(orderId)) {
        rowsByOrderId.set(orderId, []);
      }
      rowsByOrderId.get(orderId)!.push(row);
    }

    const invoiceDrafts: Omit<Invoice, 'invoiceNumber'>[] = [];
    let totalNetSales = 0;
    let totalVat = 0;
    const seenFingerprints = new Set<string>();

    for (const [orderId, rows] of rowsByOrderId.entries()) {
      const firstRow = rows[0];
      const countryName = getColumn(firstRow, ['ship country', 'versandland', 'shiptocountry', 'shippingcountry', 'country'], normalizedHeaderMap);
      const countryClassification = getCountryClassification(countryName);
      
      const vatPaidByBuyerStr = getColumn(firstRow, ['vat paid by buyer', 'vom käufer gezahlte ust'], normalizedHeaderMap);
      const vatPaidByBuyer = parseFloatSafe(vatPaidByBuyerStr) > 0;
      
      const { taxNote, vatRate: orderWideVatRate } = getTaxInfo(countryClassification, vatPaidByBuyer, taxStatus);
      
      const items: Invoice['items'] = [];
      let orderItemTotal = 0;
      
      rows.forEach(row => {
          const itemTotalStr = getColumn(row, ['item total', 'artikelsumme'], normalizedHeaderMap);
          if (itemTotalStr) {
              orderItemTotal += parseFloatSafe(itemTotalStr);
          }
      });
      
      const potentialShippingCols = ['Order Shipping', 'shipping', 'versand', 'shipping costs', 'versandkosten'];
      const shippingRow = rows.find(r => parseFloatSafe(getColumn(r, potentialShippingCols, normalizedHeaderMap)) > 0) || rows[0];
      const shippingCost = parseFloatSafe(getColumn(shippingRow, potentialShippingCols, normalizedHeaderMap));
      
      const discountAmount = parseFloatSafe(getColumn(firstRow, ['discount amount', 'rabattbetrag'], normalizedHeaderMap));
      
      const orderGrossTotal = orderItemTotal + shippingCost - discountAmount;

      if (orderGrossTotal <= 0) {
        continue;
      }
      
      const orderNetTotal = orderWideVatRate > 0 ? orderGrossTotal / (1 + orderWideVatRate / 100) : orderGrossTotal;
      const orderVatTotal = orderGrossTotal - orderNetTotal;

      rows.forEach(row => {
          const itemName = getColumn(row, ['item name', 'titel', 'title', 'artikelname'], normalizedHeaderMap);
          const itemTotalStr = getColumn(row, ['item total', 'artikelsumme'], normalizedHeaderMap);
          if (itemName && itemTotalStr) {
              const itemGross = parseFloatSafe(itemTotalStr);
              if (itemGross > 0) {
                  const itemNet = orderWideVatRate > 0 ? itemGross / (1 + orderWideVatRate / 100) : itemGross;
                  const itemVat = itemGross - itemNet;
                   items.push({
                      quantity: parseInt(getColumn(row, ['quantity', 'anzahl', 'items'], normalizedHeaderMap) || '1', 10) || 1,
                      name: itemName,
                      netAmount: itemNet,
                      vatRate: orderWideVatRate,
                      vatAmount: itemVat,
                      grossAmount: itemGross,
                  });
              }
          }
      });
      
      if (shippingCost > 0) {
          const shippingNet = orderWideVatRate > 0 ? shippingCost / (1 + orderWideVatRate / 100) : shippingCost;
          const shippingVat = shippingCost - shippingNet;
          items.push({
              quantity: 1,
              name: 'Versandkosten',
              netAmount: shippingNet,
              vatRate: orderWideVatRate,
              vatAmount: shippingVat,
              grossAmount: shippingCost,
          });
      }

      if (discountAmount > 0) {
          const discountNet = orderWideVatRate > 0 ? discountAmount / (1 + orderWideVatRate / 100) : discountAmount;
          const discountVat = discountAmount - discountNet;
          items.push({
              quantity: 1,
              name: 'Rabatt',
              netAmount: -discountNet,
              vatRate: orderWideVatRate,
              vatAmount: -discountVat,
              grossAmount: -discountAmount,
          });
      }
      
      let buyerName = getColumn(firstRow, ['ship name', 'ship to name', 'full name', 'empfaengername', 'kaeufer', 'buyer'], normalizedHeaderMap);
      let buyerAddress: string;

      const address1 = getColumn(firstRow, ['ship address1', 'ship to street 1', 'empfaenger adresse 1', 'street 1'], normalizedHeaderMap);
      const address2 = getColumn(firstRow, ['ship address2', 'ship to street 2', 'empfaenger adresse 2', 'street 2'], normalizedHeaderMap);
      const city = getColumn(firstRow, ['ship city', 'ship to city', 'empfaenger stadt', 'city'], normalizedHeaderMap);
      const state = getColumn(firstRow, ['ship state', 'ship to state', 'empfaenger bundesland', 'state'], normalizedHeaderMap);
      const zipcode = getColumn(firstRow, ['ship zipcode', 'ship to zipcode', 'empfaenger plz', 'shipping zipcode', 'zipcode'], normalizedHeaderMap);
      const countryDisplay = getColumn(firstRow, ['ship country', 'versandland', 'ship to country', 'shipping country', 'country'], normalizedHeaderMap);
      
      let addressParts = [address1, address2, `${zipcode} ${city}`];
      if(state && state !== city) {
        addressParts[1] = address2 ? `${address2}, ${state}` : state;
      }
      addressParts.push(countryDisplay);
      
      buyerAddress = addressParts.filter(part => part && part.trim() !== '' && part.trim() !== city).join('\\n');
      
      const orderDateRaw = getColumn(firstRow, ['sale date', 'bestelldatum', 'date', 'datum des kaufs'], normalizedHeaderMap);
      const orderDate = formatDate(orderDateRaw);
      
      const finalOrderDate = orderDate || new Date().toLocaleDateString('de-DE');

      const invoiceDraft: Omit<Invoice, 'invoiceNumber'> = {
        id: orderId,
        orderDate: finalOrderDate,
        serviceDate: finalOrderDate,
        buyerName: buyerName || 'Unbekannt',
        buyerAddress,
        items,
        netTotal: orderNetTotal,
        vatTotal: orderVatTotal,
        grossTotal: orderGrossTotal,
        taxNote,
        country: countryName || 'Unbekannt',
        countryClassification,
      };
      
      // Skip Duplikate anhand Fingerprint (bestehende und innerhalb derselben CSV)
      const fp = makeFingerprint(invoiceDraft as unknown as Invoice);
      if (existingFingerprints.has(fp) || seenFingerprints.has(fp)) {
        continue;
      }
      seenFingerprints.add(fp);
      invoiceDrafts.push(invoiceDraft);
      totalNetSales += invoiceDraft.netTotal;
      totalVat += invoiceDraft.vatTotal;
    }

    if (invoiceDrafts.length === 0) {
        return { data: null, error: "Keine neuen Bestellungen in der CSV-Datei gefunden. Bereits existierende Rechnungen wurden übersprungen." };
    }
    
    // Sort drafts by date to ensure chronological invoice numbers
    invoiceDrafts.sort((a, b) => {
        const dateA = new Date(a.orderDate.split('.').reverse().join('-')).getTime();
        const dateB = new Date(b.orderDate.split('.').reverse().join('-')).getTime();
        return dateA - dateB;
    });

    // Find the highest existing invoice number for each year
    const invoiceCounters: { [year: number]: number } = {};
    for (const inv of existingInvoices) {
      const match = inv.invoiceNumber.match(/RE-(\d{4})-(\d+)/);
      if (match) {
        const year = parseInt(match[1], 10);
        const num = parseInt(match[2], 10);
        if (!invoiceCounters[year] || num > invoiceCounters[year]) {
          invoiceCounters[year] = num;
        }
      }
    }
    
    const invoices: Invoice[] = [];
    for (const draft of invoiceDrafts) {
        const dateObject = new Date(draft.orderDate.split('.').reverse().join('-'));
        const orderYear = !isNaN(dateObject.getTime()) ? dateObject.getFullYear() : new Date().getFullYear();
        
        if (!invoiceCounters[orderYear]) {
            invoiceCounters[orderYear] = 0;
        }
        invoiceCounters[orderYear]++;
        const invoiceNumberForYear = invoiceCounters[orderYear];

        const finalInvoice: Invoice = {
            ...draft,
            invoiceNumber: `RE-${orderYear}-${String(invoiceNumberForYear).padStart(4, '0')}`,
        };
        invoices.push(finalInvoice);
    }
    
    const result: ProcessCsvOutput = {
      invoices,
      summary: {
        totalNetSales,
        totalVat,
      },
    };
    
    return { data: result, error: null };
  } catch (error) {
    console.error("Error in generateInvoicesAction:", error);
    const errorMessage = error instanceof Error ? error.message : "Ein unerwarteter Fehler ist aufgetreten.";
    return { data: null, error: `Ein unerwarteter Fehler ist aufgetreten. Bitte überprüfen Sie die CSV-Datei und versuchen Sie es erneut. Details: ${errorMessage}` };
  }
}

export async function processBankStatementAction(csvData: string): Promise<{ totalAmount?: number; transactions?: BankTransaction[]; foundEtsyTransaction?: boolean; error?: string; }> {
    try {
        const parseResult = Papa.parse<string[]>(csvData, {
            skipEmptyLines: true,
            header: false,
            dynamicTyping: false,
        });

        // Ignoriere Parsing-Fehler für Bank Statements, da diese oft verschiedene Formate haben
        console.log("CSV parsing result:", parseResult);

        const data = parseResult.data as unknown as string[][];

        const headerKeywords = {
            amount: ['betrag', 'amount', 'summe'],
            description: ['verwendungszweck', 'beschreibung', 'buchungstext', 'text', 'auftraggeber', 'empfänger', 'beguenstigter/zahlungspflichtiger', 'name', 'auftraggeber / empfänger', 'begünstiger/zahlungspflichtiger'],
            date: ['datum', 'date', 'buchungstag', 'valuta']
        };

        let headerRowIndex = -1;
        let headers: string[] = [];
        let maxScore = 0;

        for (let i = 0; i < data.length && i < 15; i++) { 
            const row = data[i];
            if (!Array.isArray(row) || row.length < 2) continue;
            
            let score = 0;
            const lowerCaseRow = row.map(cell => String(cell || '').toLowerCase().trim());
            
            for (const key in headerKeywords) {
                if (lowerCaseRow.some(cell => headerKeywords[key as keyof typeof headerKeywords].some(kw => cell.includes(kw)))) {
                    score++;
                }
            }
            if (score > maxScore && score > 1) { 
                maxScore = score;
                headerRowIndex = i;
                headers = lowerCaseRow;
            }
        }

        if (headerRowIndex === -1) {
            return { error: "Konnte keine gültige Header-Zeile mit Spalten wie 'Betrag', 'Datum' oder 'Verwendungszweck' in der CSV-Datei finden. Bitte prüfen Sie die Datei." };
        }

        const findIndex = (keywords: string[]): number => {
            for (const kw of keywords) {
                const index = headers.findIndex(h => h.includes(kw));
                if (index !== -1) return index;
            }
            return -1;
        };
        
        const amountIndex = findIndex(headerKeywords.amount);
        const dateIndex = findIndex(headerKeywords.date);
        const descriptionIndices = headerKeywords.description
            .map(kw => headers.findIndex(h => h.includes(kw)))
            .filter(index => index !== -1);
        const uniqueDescriptionIndices = [...new Set(descriptionIndices)];

        if (amountIndex === -1) return { error: "Konnte die 'Betrag'-Spalte in der CSV nicht finden." };
        if (uniqueDescriptionIndices.length === 0) return { error: "Konnte keine Spalte für den Verwendungszweck oder die Beschreibung in der CSV finden." };
        if (dateIndex === -1) return { error: "Konnte die 'Datum'-Spalte in der CSV nicht finden."};

        let totalAmount = 0;
        let foundEtsyTransaction = false;
        const transactions: BankTransaction[] = [];
        const dataStartIndex = headerRowIndex + 1;

        for (let i = dataStartIndex; i < data.length; i++) {
            const row = data[i];
            
            const maxIndex = Math.max(amountIndex, dateIndex, ...uniqueDescriptionIndices);
            if (!Array.isArray(row) || row.length <= maxIndex) {
                 continue;
            }
            
            const fullDescription = uniqueDescriptionIndices.map(idx => row[idx] || '').join(' ').toLowerCase();
            const amountStr = row[amountIndex];
            const dateValue = row[dateIndex];
            
            if (!amountStr || !dateValue || fullDescription.trim() === '' || isNaN(parseFloatSafe(amountStr)) ) {
                continue; 
            }

            if (fullDescription.includes('etsy')) {
                foundEtsyTransaction = true;
                const amount = parseFloatSafe(amountStr);
                totalAmount += amount;
                
                transactions.push({
                    date: dateValue || 'N/A',
                    description: uniqueDescriptionIndices.map(idx => row[idx] || '').join(' '),
                    amount: amount
                });
            }
        }
        
        return { totalAmount, transactions, foundEtsyTransaction };

    } catch (error) {
        console.error("Error processing bank statement CSV:", error);
        return { error: 'Ein unerwarteter Fehler ist beim Verarbeiten des Kontoauszugs aufgetreten.' };
    }
}


