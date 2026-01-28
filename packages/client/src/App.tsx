import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { Toaster } from 'sonner'
import Dashboard from './pages/Dashboard'
import CustomerMapping from './pages/CustomerMapping'
import SkuMapping from './pages/SkuMapping'
import InvoicesPage from './pages/InvoicesPage'

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors />
      <div className="min-h-screen bg-background">
        <nav className="border-b">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <Link to="/" className="text-xl font-bold">
              QB Sync
            </Link>
            <div className="flex items-center gap-4">
              <Link to="/" className="text-sm hover:underline">
                Dashboard
              </Link>
              <Link to="/customers" className="text-sm hover:underline">
                Customers
              </Link>
              <Link to="/skus" className="text-sm hover:underline">
                SKUs
              </Link>
              <Link to="/invoices" className="text-sm hover:underline">
                Invoices
              </Link>
            </div>
          </div>
        </nav>

        <main className="container mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/customers" element={<CustomerMapping />} />
            <Route path="/skus" element={<SkuMapping />} />
            <Route path="/invoices" element={<InvoicesPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
