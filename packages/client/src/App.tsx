import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import CustomerMapping from './pages/CustomerMapping'

function App() {
  return (
    <BrowserRouter>
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
            <Route path="/skus" element={<div>SKU Mapping (Coming Soon)</div>} />
            <Route path="/invoices" element={<div>Invoice Sync (Coming Soon)</div>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
