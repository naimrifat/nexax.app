import React from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight } from 'lucide-react';
import MarketplaceLogo from '../components/MarketplaceLogo';

const PricingPage: React.FC = () => {
  return (
    <div className="py-16 md:py-24 bg-gradient-to-br from-teal-50 to-purple-50">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Choose the perfect plan for your business. No hidden fees.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Basic Plan */}
          <div className="card p-8 hover:shadow-lg transition-shadow">
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Basic</h3>
              <div className="flex items-baseline mb-4">
                <span className="text-4xl font-bold text-gray-900">$29.99</span>
                <span className="text-gray-500 ml-2">/month</span>
              </div>
              <p className="text-gray-600">Perfect for individual sellers getting started.</p>
            </div>

            <ul className="space-y-4 mb-8">
              <PricingFeature text="50 listings per month" />
              <PricingFeature text="Basic AI descriptions" />
              <PricingFeature text="2 marketplaces" />
              <PricingFeature text="Standard support" />
              <PricingFeature text="Basic analytics" />
            </ul>

            <Link to="/signup" className="btn btn-outline w-full text-center">
              Get Started
            </Link>
          </div>

          {/* Pro Plan */}
          <div className="card p-8 bg-gradient-to-br from-teal-500 to-teal-600 text-white transform hover:scale-105 transition-all relative">
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <span className="bg-purple-600 text-white text-sm font-medium px-4 py-1 rounded-full">
                Most Popular
              </span>
            </div>

            <div className="mb-8">
              <h3 className="text-2xl font-bold mb-4">Pro</h3>
              <div className="flex items-baseline mb-4">
                <span className="text-4xl font-bold">$59.99</span>
                <span className="opacity-80 ml-2">/month</span>
              </div>
              <p className="text-teal-50">Enhanced features for growing businesses.</p>
            </div>

            <ul className="space-y-4 mb-8">
              <PricingFeature text="200 listings per month" light />
              <PricingFeature text="Advanced AI descriptions" light />
              <PricingFeature text="All marketplaces" light />
              <PricingFeature text="Priority support" light />
              <PricingFeature text="Advanced analytics" light />
              <PricingFeature text="Bulk listing creation" light />
              <PricingFeature text="Custom templates" light />
            </ul>

            <Link to="/signup" className="btn bg-white text-teal-600 hover:bg-teal-50 w-full text-center">
              Get Started
            </Link>
          </div>

          {/* Business Plan */}
          <div className="card p-8 hover:shadow-lg transition-shadow">
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Business</h3>
              <div className="flex items-baseline mb-4">
                <span className="text-4xl font-bold text-gray-900">$99.99</span>
                <span className="text-gray-500 ml-2">/month</span>
              </div>
              <p className="text-gray-600">Maximum power for high-volume sellers.</p>
            </div>

            <ul className="space-y-4 mb-8">
              <PricingFeature text="Unlimited listings" />
              <PricingFeature text="Premium AI descriptions" />
              <PricingFeature text="All marketplaces + API" />
              <PricingFeature text="24/7 priority support" />
              <PricingFeature text="Advanced analytics + API" />
              <PricingFeature text="Bulk listing creation" />
              <PricingFeature text="Custom templates" />
              <PricingFeature text="White-label exports" />
              <PricingFeature text="Team collaboration" />
            </ul>

            <Link to="/signup" className="btn btn-outline w-full text-center">
              Get Started
            </Link>
          </div>
        </div>

        {/* Marketplace Logos */}
        <div className="mt-24 text-center">
          <p className="text-lg text-gray-600 mb-8">Works with all major marketplaces</p>
          <div className="flex flex-wrap justify-center items-center gap-12 max-w-2xl mx-auto">
            <MarketplaceLogo name="eBay" className="h-8" />
            <MarketplaceLogo name="Poshmark" className="h-8" />
            <MarketplaceLogo name="Mercari" className="h-8" />
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mt-24 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <FaqItem 
              question="How does the listing creation work?"
              answer="Simply upload your product photos, and our AI will analyze them to generate professional descriptions, titles, and categorization. You can review and edit before publishing."
            />
            <FaqItem 
              question="Can I switch plans anytime?"
              answer="Yes! You can upgrade or downgrade your plan at any time. Changes will be reflected in your next billing cycle."
            />
            <FaqItem 
              question="Is there a free trial?"
              answer="We offer a 14-day free trial on all plans. No credit card required to start."
            />
            <FaqItem 
              question="What payment methods do you accept?"
              answer="We accept all major credit cards, PayPal, and offer invoicing for annual business plans."
            />
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-24 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-xl text-gray-600 mb-8">Join thousands of sellers who are saving time and increasing sales.</p>
          <Link to="/signup" className="btn btn-primary px-8 py-3 text-lg inline-flex items-center">
            Start Your Free Trial
            <ArrowRight className="ml-2 w-5 h-5" />
          </Link>
          <p className="mt-4 text-sm text-gray-500">No credit card required</p>
        </div>
      </div>
    </div>
  );
};

interface PricingFeatureProps {
  text: string;
  light?: boolean;
}

const PricingFeature: React.FC<PricingFeatureProps> = ({ text, light }) => (
  <li className="flex items-start">
    <Check className={`w-5 h-5 mr-3 ${light ? 'text-teal-50' : 'text-teal-500'}`} />
    <span className={light ? 'text-teal-50' : 'text-gray-600'}>{text}</span>
  </li>
);

interface FaqItemProps {
  question: string;
  answer: string;
}

const FaqItem: React.FC<FaqItemProps> = ({ question, answer }) => (
  <div className="card p-6">
    <h3 className="text-lg font-semibold text-gray-900 mb-2">{question}</h3>
    <p className="text-gray-600">{answer}</p>
  </div>
);

export default PricingPage;