'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from '@/lib/supabase';
import { useToast } from "@/hooks/use-toast";

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    passwordConfirm: '',
  });
  const [termsAccepted, setTermsAccepted] = useState<boolean | 'indeterminate'>(false);
  const [privacyAccepted, setPrivacyAccepted] = useState<boolean | 'indeterminate'>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validation
    if (!formData.email) {
      setError('Bitte geben Sie Ihre E-Mail-Adresse ein.');
      setLoading(false);
      return;
    }
    if (!formData.password || !formData.passwordConfirm) {
      setError('Bitte vergeben Sie ein Passwort und bestätigen Sie es.');
      setLoading(false);
      return;
    }
    if (formData.password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.');
      setLoading(false);
      return;
    }
    if (formData.password !== formData.passwordConfirm) {
      setError('Die Passwörter stimmen nicht überein.');
      setLoading(false);
      return;
    }

    if (!termsAccepted || !privacyAccepted) {
      setError('Bitte stimmen Sie den AGB und der Datenschutzerklärung zu.');
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });

      if (error) {
        const msg = (error as any)?.message?.toLowerCase?.() || '';
        if (msg.includes('already') || msg.includes('exist')) {
          // Bereits registriert → direkt zur Login-Seite weiterleiten mit Hinweis
          router.push('/login?reason=already_registered');
        } else {
          setError(error.message);
        }
        return;
      }

      toast({
        title: "Registrierung gestartet",
        description: "Bitte bestätigen Sie Ihre E-Mail. Prüfen Sie Ihren Posteingang.",
      });

      router.push('/login?registered=1');
    } catch (err: any) {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setLoading(false);
    }
  };

  

  return (
    <div className="w-full max-w-lg space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Jetzt registrieren</h1>
        <p className="text-muted-foreground">Starten Sie Ihren 14-tägigen kostenlosen Test</p>
      </div>

      <Card className="bg-secondary/50">
          <CardHeader>
              <CardTitle>Ihre Vorteile:</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
             <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0"/>
                <p>14 Tage kostenlos und unverbindlich testen.</p>
             </div>
             <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0"/>
                <p>Bis zu 10.000 Rechnungen pro Monat generieren.</p>
             </div>
             <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0"/>
                <p>Automatische Steuerberechnung für physische & digitale Produkte.</p>
             </div>
             <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0"/>
                <p>DSGVO-konforme Datenverarbeitung.</p>
             </div>
          </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail-Adresse *</Label>
              <Input 
                id="email" 
                name="email"
                type="email" 
                placeholder="ihre@email.de" 
                value={formData.email}
                onChange={handleInputChange}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort *</Label>
              <Input 
                id="password" 
                name="password"
                type="password" 
                placeholder="Mindestens 8 Zeichen" 
                value={formData.password}
                onChange={handleInputChange}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passwordConfirm">Passwort bestätigen *</Label>
              <Input 
                id="passwordConfirm" 
                name="passwordConfirm"
                type="password" 
                placeholder="Passwort wiederholen" 
                value={formData.passwordConfirm}
                onChange={handleInputChange}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-3 pt-2">
               <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="terms" 
                    checked={termsAccepted}
                    onCheckedChange={(checked) => setTermsAccepted(checked)}
                    disabled={loading}
                  />
                  <Label htmlFor="terms" className="text-sm font-normal">
                      Ich stimme den <Link href="/agb" className="underline hover:text-primary">Allgemeinen Geschäftsbedingungen</Link> zu. *
                  </Label>
              </div>
               <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="privacy" 
                    checked={privacyAccepted}
                    onCheckedChange={(checked) => setPrivacyAccepted(checked)}
                    disabled={loading}
                  />
                  <Label htmlFor="privacy" className="text-sm font-normal">
                      Ich stimme der <Link href="/datenschutz" className="underline hover:text-primary">Datenschutzerklärung</Link> zu. *
                  </Label>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
           
            <div className="pt-4">
              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Registrieren
              </Button>
            </div>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
            <div className="text-center">
              <Link href="/login" passHref>
                  <Button variant="link" size="sm">Bereits ein Konto? Anmelden</Button>
              </Link>
            </div>
        </CardFooter>
      </Card>
    </div>
  );
}
