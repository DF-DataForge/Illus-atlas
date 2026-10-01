import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Database, Server, CheckCircle2, AlertCircle, RefreshCw, Download } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSalesPoints, testOdooConnection } from "@/lib/api";

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  
  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: testOdooConnection,
    onSuccess: () => {
      setConnectionStatus('success');
      toast({
        title: "Connection Successful",
        description: "Successfully connected to Odoo ERP instance.",
      });
    },
    onError: (error: Error) => {
      setConnectionStatus('error');
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: getSalesPoints,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sales-points"] });
      toast({
        title: "Sync Complete",
        description: `Loaded ${data.salesPoints.length} sales points from ${data.source === "odoo" ? "Odoo" : "the PDF fallback"}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleTestConnection = () => {
    setConnectionStatus('idle');
    testConnectionMutation.mutate();
  };

  const handleSync = () => {
    syncMutation.mutate();
  };

  return (
    <Layout>
      <div className="container mx-auto max-w-4xl p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <h2 className="text-2xl font-display font-bold text-foreground">System Settings</h2>
          <p className="text-muted-foreground">Configure external integrations and system parameters.</p>
        </div>

        <Tabs defaultValue="odoo" className="w-full">
          <TabsList className="grid w-full grid-cols-3 lg:w-[400px] bg-card/50">
            <TabsTrigger value="odoo" data-testid="tab-odoo">Odoo ERP</TabsTrigger>
            <TabsTrigger value="grid" data-testid="tab-grid">Grid Protocol</TabsTrigger>
            <TabsTrigger value="account" data-testid="tab-account">Account</TabsTrigger>
          </TabsList>
          
          <TabsContent value="odoo" className="space-y-4 mt-6">
            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-[#714B67]/20 border border-[#714B67]/50">
                    <Database className="w-6 h-6 text-[#714B67]" /> 
                  </div>
                  <div>
                    <CardTitle>Odoo Integration</CardTitle>
                    <CardDescription>Connect to Odoo contacts tagged “verkooppunt”.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {connectionStatus === 'success' && (
                  <Alert className="bg-green-500/10 border-green-500/50 text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertTitle>Connected</AlertTitle>
                    <AlertDescription>
                      The server is successfully connected to Odoo.
                    </AlertDescription>
                  </Alert>
                )}

                {connectionStatus === 'error' && (
                  <Alert className="bg-red-500/10 border-red-500/50 text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Connection Failed</AlertTitle>
                    <AlertDescription>
                      Unable to connect. Check the Odoo server environment variables and ODOO_PASSWORD secret.
                    </AlertDescription>
                  </Alert>
                )}

                <Alert className="border-border/50 bg-background/40">
                  <Server className="h-4 w-4" />
                  <AlertTitle>Server-side configuration</AlertTitle>
                  <AlertDescription>
                    Odoo credentials are configured outside the app. Set ODOO_URL, ODOO_DATABASE and
                    ODOO_USERNAME as backend environment variables, and store ODOO_PASSWORD as a Replit Secret.
                  </AlertDescription>
                </Alert>
              </CardContent>
              <CardFooter className="flex justify-between border-t border-border/50 pt-6">
                <div className="flex gap-2">
                  <Button 
                    onClick={handleTestConnection} 
                    disabled={testConnectionMutation.isPending} 
                    className="bg-[#714B67] hover:bg-[#714B67]/80 text-white"
                    data-testid="button-test-connection"
                  >
                    {testConnectionMutation.isPending ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Testing...
                      </>
                    ) : (
                      <>Test Connection</>
                    )}
                  </Button>
                  <Button 
                    onClick={handleSync}
                    disabled={syncMutation.isPending}
                    className="bg-primary hover:bg-primary/80 text-primary-foreground"
                    data-testid="button-sync"
                  >
                    {syncMutation.isPending ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Syncing...
                      </>
                    ) : (
                      <>
                          <Download className="mr-2 h-4 w-4" /> Refresh from Odoo
                      </>
                    )}
                  </Button>
                </div>
              </CardFooter>
            </Card>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-sm text-blue-200">
                <p className="font-semibold mb-1">Integration Notes</p>
                <p className="opacity-90 mb-2">
                  This application securely connects to Odoo and reads contacts carrying the
                  <strong> verkooppunt</strong> label. Name, address, phone, email, website and
                  geolocation are shown on the map.
                </p>
                <p className="opacity-90 text-xs">
                  Existing Odoo coordinates are used first. For contacts without coordinates, the
                  backend automatically looks up the address. Contacts without a reliable address
                  match still appear in the list below the map.
                </p>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="grid">
            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
               <CardHeader><CardTitle>Grid Protocols</CardTitle></CardHeader>
               <CardContent className="text-muted-foreground text-sm">
                 IEC 61850 and Modbus TCP/IP configuration settings would go here.
               </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
