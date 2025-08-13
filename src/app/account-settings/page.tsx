'use client';

import { useState, useEffect, Suspense } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useRouter, useSearchParams } from 'next/navigation';

function AccountSettingsContent() {
    const { toast } = useToast();
    const { user } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [changingPassword, setChangingPassword] = useState(false);
    const [error, setError] = useState('');
    const [billingLoading, setBillingLoading] = useState(false);
    const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
    const [hasStripeSubscription, setHasStripeSubscription] = useState(false);
    const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
    
    const [formData, setFormData] = useState({
        email: '',
        newEmail: ''
    });

    useEffect(() => {
        if (searchParams?.get('checkout') === 'success') {
            toast({ title: 'Danke!', description: 'Ihr Abo wurde eingerichtet.' });
            // Entferne Query-Param und erzwinge sofortige Aktualisierung aller Daten
            router.replace('/account-settings');
            router.refresh();
        }
        if (searchParams?.get('portal') === 'return') {
            // Nach Rückkehr aus dem Portal frische den Status und UI direkt
            (async () => {
                try {
                    const { data } = await supabase
                        .from('users')
                        .select('subscription_status, stripe_subscription_id, cancel_at_period_end')
                        .eq('id', user!.id)
                        .single();
                    const status = (data as any)?.subscription_status as string | null;
                    const willCancel = !!(data as any)?.cancel_at_period_end;
                    const hasSub = !!(data as any)?.stripe_subscription_id && ['active','trialing','past_due','paused'].includes(status || '') && !willCancel;
                    setSubscriptionStatus(status ?? null);
                    setHasStripeSubscription(!!(data as any)?.stripe_subscription_id);
                    setCancelAtPeriodEnd(willCancel);
                    // Entferne Query-Param
                    router.replace('/account-settings');
                    if (!hasSub) {
                        router.refresh();
                    }
                } catch (e) {
                    console.warn('Portal return refresh failed', e);
                }
            })();
        }
        if (searchParams?.get('billing') === 'required') {
            toast({ variant: 'destructive', title: 'Abo erforderlich', description: 'Bitte schließen Sie ein Abo ab, um fortzufahren.' });
        }
        if (searchParams?.get('setup') === 'required') {
            toast({ title: 'Fast geschafft!', description: 'Bitte hinterlegen Sie jetzt eine Zahlungsmethode (keine Abbuchung während des Tests).' });
        }
        if (!user) {
            setLoading(false);
            return;
        }

        setFormData(prev => ({
            ...prev,
            email: user.email || '',
            newEmail: user.email || ''
        }));
        // Lade Abo-Status
        (async () => {
            try {
                const { data } = await supabase
                    .from('users')
                    .select('subscription_status, stripe_subscription_id, cancel_at_period_end')
                    .eq('id', user.id)
                    .single();
                setSubscriptionStatus((data as any)?.subscription_status ?? null);
                setHasStripeSubscription(!!(data as any)?.stripe_subscription_id);
                setCancelAtPeriodEnd(!!(data as any)?.cancel_at_period_end);
            } catch (e) {
                console.warn('Load subscription state failed', e);
            } finally {
                setLoading(false);
            }
        })();
    }, [user]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({
            ...prev,
            [e.target.name]: e.target.value
        }));
    };

    // Profilverwaltung der Unternehmensdaten entfällt hier bewusst

    const handleChangeEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        if (!formData.newEmail) {
            setError('Bitte geben Sie eine neue E-Mail-Adresse ein.');
            return;
        }

        if (formData.newEmail === formData.email) {
            setError('Die neue E-Mail-Adresse ist identisch mit der aktuellen.');
            return;
        }

        setChangingPassword(true); // Reuse loading state
        setError('');

        try {
            const { error } = await supabase.auth.updateUser({
                email: formData.newEmail,
            });

            if (error) {
                setError(error.message);
                return;
            }

            toast({
                title: "E-Mail-Änderung beantragt",
                description: "Eine Bestätigungs-E-Mail wurde an Ihre neue E-Mail-Adresse gesendet.",
            });

            // Reset new email field
            setFormData(prev => ({
                ...prev,
                newEmail: formData.email
            }));
        } catch (error) {
            console.error('Error changing email:', error);
            setError('Ein Fehler beim Ändern der E-Mail ist aufgetreten.');
        } finally {
            setChangingPassword(false);
        }
    };

    const handleRequestPasswordReset = async () => {
        if (!user?.email) return;

        setChangingPassword(true);
        setError('');

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                redirectTo: `${window.location.origin}/reset-password`
            });

            if (error) {
                setError(error.message);
                return;
            }

            toast({
                title: "E-Mail gesendet!",
                description: "Prüfen Sie Ihren Posteingang für den Passwort-Reset-Link.",
            });
        } catch (error) {
            console.error('Error requesting password reset:', error);
            setError('Ein Fehler beim Anfordern des Passwort-Resets ist aufgetreten.');
        } finally {
            setChangingPassword(false);
        }
    };

    const startCheckout = async () => {
        try {
            setBillingLoading(true);
            const res = await fetch('/api/stripe/checkout', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data?.url) {
                window.location.href = data.url as string;
                return;
            }
            throw new Error(data?.error || 'Checkout fehlgeschlagen');
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Fehler', description: e.message || 'Checkout fehlgeschlagen' });
        } finally {
            setBillingLoading(false);
        }
    };

    const openPortal = async () => {
        try {
            setBillingLoading(true);
            // Prüfe Abo-Status. Ohne Abo → Checkout; mit Abo/Trial → Portal
            const { data } = await supabase
                .from('users')
                .select('subscription_status, stripe_subscription_id, cancel_at_period_end')
                .eq('id', user!.id)
                .single();
            const status = (data as any)?.subscription_status as string | null;
            const hasStripeSub = !!(data as any)?.stripe_subscription_id;
            const isActiveStatus = ['active','trialing','past_due','paused'].includes(status || '');
            const willCancel = !!(data as any)?.cancel_at_period_end;
            const hasActiveSubscription = hasStripeSub && isActiveStatus && !willCancel;
            if (hasActiveSubscription) {
                const res = await fetch('/api/stripe/portal', { method: 'POST', credentials: 'include' });
                const d = await res.json();
                if (d?.url) { window.location.href = d.url as string; return; }
                throw new Error(d?.error || 'Portal konnte nicht geöffnet werden.');
            }
            // Kein Abo → Checkout
            const res = await fetch('/api/stripe/checkout', { method: 'POST', credentials: 'include' });
            const d = await res.json();
            if (d?.url) { window.location.href = d.url as string; return; }
            throw new Error(d?.error || 'Checkout fehlgeschlagen');
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Fehler', description: e.message || 'Aktion fehlgeschlagen' });
        } finally {
            setBillingLoading(false);
        }
    };

    const startSetup = async () => {
        try {
            setBillingLoading(true);
            const res = await fetch('/api/stripe/setup', { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data?.url) {
                window.location.href = data.url as string;
                return;
            }
            throw new Error(data?.error || 'Setup fehlgeschlagen');
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Fehler', description: e.message || 'Setup fehlgeschlagen' });
        } finally {
            setBillingLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="container mx-auto w-full max-w-xl flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="container mx-auto w-full max-w-xl space-y-6">
            {/* E-Mail ändern */}
            <Card>
                <CardHeader>
                    <CardTitle>E-Mail-Adresse ändern</CardTitle>
                    <CardDescription>
                        Ändern Sie hier Ihre Anmelde-E-Mail-Adresse. Sie erhalten eine Bestätigungs-E-Mail.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleChangeEmail} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Aktuelle E-Mail-Adresse</Label>
                            <Input
                                id="email"
                                name="email"
                                type="email"
                                value={formData.email}
                                disabled
                                className="bg-muted"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="newEmail">Neue E-Mail-Adresse *</Label>
                            <Input
                                id="newEmail"
                                name="newEmail"
                                type="email"
                                value={formData.newEmail}
                                onChange={handleInputChange}
                                placeholder="neue@email.de"
                                required
                            />
                        </div>

                        <Button type="submit" className="w-full" disabled={changingPassword}>
                            {changingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            E-Mail-Adresse ändern
                        </Button>
                    </form>
                </CardContent>
            </Card>

            {/* Passwort zurücksetzen entfernt: erfolgt über Login-Seite */}

            {/* Abonnement (Stripe) */}
            <Card>
                <CardHeader>
                    <CardTitle>Abonnement</CardTitle>
                    <CardDescription>
                        Verwalten Sie Ihr Abo über Stripe.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-col gap-2">
                        <Button onClick={openPortal} disabled={billingLoading} className="w-full border border-input">
                            Abo verwalten (Stripe)
                        </Button>
                        <Button
                          onClick={async () => {
                            try {
                              setBillingLoading(true);
                              const hasActiveSubscription = hasStripeSubscription && ['active','trialing','past_due','paused'].includes(subscriptionStatus || '') && !cancelAtPeriodEnd;
                              if (hasActiveSubscription) {
                                // Kündigen / verwalten via Portal
                                const res = await fetch('/api/stripe/portal', { method: 'POST', credentials: 'include' });
                                const d = await res.json();
                                if (d?.url) { window.location.href = d.url as string; return; }
                                throw new Error(d?.error || 'Portal konnte nicht geöffnet werden. Prüfen Sie Ihre Portal-Konfiguration in Stripe (Testmodus).');
                              } else {
                                // Abo abschließen via Checkout
                                const res = await fetch('/api/stripe/checkout', { method: 'POST', credentials: 'include' });
                                const d = await res.json();
                                if (d?.url) { window.location.href = d.url as string; return; }
                                throw new Error(d?.error || 'Checkout fehlgeschlagen');
                              }
                            } catch (e: any) {
                              toast({ variant: 'destructive', title: 'Fehler', description: e.message || 'Aktion fehlgeschlagen' });
                            } finally {
                              setBillingLoading(false);
                            }
                          }}
                          disabled={billingLoading}
                          className="w-full"
                        >
                          {hasStripeSubscription && ['active','trialing','past_due','paused'].includes(subscriptionStatus || '') && !cancelAtPeriodEnd ? 'Abo kündigen' : 'Abo abschließen'}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Rechnungen und Kündigung verwalten Sie direkt im Stripe-Portal.</p>
                </CardContent>
            </Card>
        </div>
    );
}

export default function AccountSettingsPage() {
    return (
        <Suspense fallback={
            <div className="container mx-auto w-full max-w-xl flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        }>
            <AccountSettingsContent />
        </Suspense>
    );
}
