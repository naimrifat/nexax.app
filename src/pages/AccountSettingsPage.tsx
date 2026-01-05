import React from "react";
import { EbayConnectCard } from "../components/EbayConnectCard";

export default function AccountSettingsPage() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Account</h1>
        <p className="text-gray-600">Manage your account and marketplace connections.</p>
      </div>

      {/* eBay OAuth Connection */}
      <EbayConnectCard />

      {/* Future account settings can go here */}
    </div>
  );
}
