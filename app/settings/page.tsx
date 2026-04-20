'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { User, Lock, Save, Loader2, ArrowLeft, CheckCircle2, UserPlus, Users, ShieldOff, ShieldCheck, KeyRound, X } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [createUserMessage, setCreateUserMessage] = useState('');
  const [createUserError, setCreateUserError] = useState('');
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [adminPwUserId, setAdminPwUserId] = useState<string | null>(null);
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [adminPwError, setAdminPwError] = useState('');
  const [adminPwMessage, setAdminPwMessage] = useState('');
  const [isAdminChangingPw, setIsAdminChangingPw] = useState(false);
  const isAdmin = session?.user?.isAdmin === true;

  // User list state
  const [users, setUsers] = useState<Array<{id: string, email: string, name: string, disabled: boolean, isEnvAdmin: boolean, createdAt: string}>>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login');
    } else if (session?.user) {
      setName(session.user.name || '');
      setEmail(session.user.email || '');
      // Load users if admin - use session email directly
      if (session.user.isAdmin) {
        fetchUsers();
      }
    }
  }, [session, status, router]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage('');
    setProfileError('');
    
    // Validate name
    if (!name || name.trim() === '') {
      setProfileError('Name cannot be empty');
      return;
    }

    // Get and validate email
    const userEmail = session?.user?.email || email;
    if (!userEmail) {
      setProfileError('User email not available');
      return;
    }

    setIsUpdatingProfile(true);

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': userEmail
        },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update profile');
      }

      await update({ name: name.trim() });
      setProfileMessage('Profile updated successfully');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage('');
    setPasswordError('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setIsChangingPassword(true);

    try {
      // Use session email directly to avoid state timing issues
      const userEmail = session?.user?.email || email;
      const response = await fetch('/api/user/password', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': userEmail
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to change password');
      }

      setPasswordMessage('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleToggleUser = async (userId: string, currentDisabled: boolean) => {
    setTogglingUserId(userId);
    try {
      const adminEmail = session?.user?.email;
      const response = await fetch(`/api/user/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-user-email': adminEmail || '' },
        body: JSON.stringify({ disabled: !currentDisabled }),
      });
      if (response.ok) {
        fetchUsers();
      }
    } catch (error) {
      console.error('Failed to toggle user:', error);
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateUserMessage('');
    setCreateUserError('');
    setIsCreatingUser(true);

    try {
      // Use session email directly to avoid state timing issues
      const adminEmail = session?.user?.email || email;
      const response = await fetch('/api/user/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': adminEmail
        },
        body: JSON.stringify({ 
          name: newUserName, 
          email: newUserEmail, 
          password: newUserPassword 
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create user');
      }

      setCreateUserMessage('User created successfully');
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      // Refresh user list
      fetchUsers();
    } catch (error) {
      setCreateUserError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleAdminChangePassword = async (userId: string) => {
    setAdminPwError('');
    setAdminPwMessage('');
    if (adminNewPassword !== adminConfirmPassword) {
      setAdminPwError('Passwords do not match');
      return;
    }
    if (adminNewPassword.length < 6) {
      setAdminPwError('Password must be at least 6 characters');
      return;
    }
    setIsAdminChangingPw(true);
    try {
      const adminEmail = session?.user?.email;
      const response = await fetch(`/api/user/${userId}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-email': adminEmail || '' },
        body: JSON.stringify({ newPassword: adminNewPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update password');
      setAdminPwMessage('Password updated successfully');
      setAdminNewPassword('');
      setAdminConfirmPassword('');
      setTimeout(() => { setAdminPwUserId(null); setAdminPwMessage(''); }, 1500);
    } catch (error) {
      setAdminPwError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsAdminChangingPw(false);
    }
  };

  const fetchUsers = async () => {
    setIsLoadingUsers(true);
    try {
      // Use session email directly to avoid state timing issues
      const adminEmail = session?.user?.email;
      if (!adminEmail) return;
      console.log('Fetching users for admin:', adminEmail);
      const response = await fetch('/api/user/list', {
        headers: {
          'x-user-email': adminEmail
        }
      });
      
      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Users data received:', data);
        setUsers(data.users || []);
      } else {
        const errorData = await response.json();
        console.error('Error fetching users:', errorData);
        setUsers([]);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
      setUsers([]);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-sky-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Header */}
          <div className="mb-8">
            <Link 
              href="/" 
              className="inline-flex items-center text-sm text-gray-500 hover:text-sky-600 mb-4"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to home
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-600 mt-1">Manage your account settings and preferences</p>
          </div>

          {/* Profile Settings */}
          <Card className="mb-6 shadow-lg border-0">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center">
                  <User className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <CardTitle>Profile</CardTitle>
                  <CardDescription>Update your personal information</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {profileMessage && (
                <Alert className="mb-4 bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">{profileMessage}</AlertDescription>
                </Alert>
              )}
              
              {profileError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{profileError}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    disabled
                    className="h-11 bg-gray-100"
                  />
                  <p className="text-xs text-gray-500">Email cannot be changed</p>
                </div>

                <Button
                  type="submit"
                  className="bg-sky-600 hover:bg-sky-700"
                  disabled={isUpdatingProfile}
                >
                  {isUpdatingProfile ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Password Settings */}
          <Card className="shadow-lg border-0">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center">
                  <Lock className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <CardTitle>Password</CardTitle>
                  <CardDescription>Change your password</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {passwordMessage && (
                <Alert className="mb-4 bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800">{passwordMessage}</AlertDescription>
                </Alert>
              )}
              
              {passwordError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{passwordError}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-11"
                    required
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-11"
                    required
                    minLength={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-11"
                    required
                    minLength={6}
                  />
                </div>

                <Button
                  type="submit"
                  className="bg-sky-600 hover:bg-sky-700"
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Changing...
                    </>
                  ) : (
                    <>
                      <Lock className="mr-2 h-4 w-4" />
                      Change Password
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Admin: Create User Section - Only visible to admin */}
          {isAdmin && (
            <Card className="shadow-lg border-0 mt-6">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <UserPlus className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle>Create User</CardTitle>
                    <CardDescription>Add a new user account (Admin only)</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {createUserMessage && (
                  <Alert className="mb-4 bg-green-50 border-green-200">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800">{createUserMessage}</AlertDescription>
                  </Alert>
                )}
                
                {createUserError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>{createUserError}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="newUserName">Full Name</Label>
                    <Input
                      id="newUserName"
                      type="text"
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      className="h-11"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newUserEmail">Email</Label>
                    <Input
                      id="newUserEmail"
                      type="email"
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      className="h-11"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newUserPassword">Password</Label>
                    <Input
                      id="newUserPassword"
                      type="password"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      className="h-11"
                      required
                      minLength={6}
                    />
                    <p className="text-xs text-gray-500">Password must be at least 6 characters</p>
                  </div>

                  <Button
                    type="submit"
                    className="bg-green-600 hover:bg-green-700"
                    disabled={isCreatingUser}
                  >
                    {isCreatingUser ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Create User
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Admin: User List Section - Only visible to admin */}
          {isAdmin && (
            <Card className="shadow-lg border-0 mt-6">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle>User List</CardTitle>
                    <CardDescription>All registered users</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingUsers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
                  </div>
                ) : users.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No users found</p>
                ) : (
                  <div className="space-y-3">
                    {users.map((user) => (
                      <div key={user.id} className="space-y-0">
                      <div
                        className={`flex items-center justify-between p-3 rounded-lg ${user.disabled ? 'bg-red-50' : 'bg-gray-50'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${user.disabled ? 'bg-red-100' : 'bg-sky-100'}`}>
                            <User className={`h-4 w-4 ${user.disabled ? 'text-red-400' : 'text-sky-600'}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className={`font-medium ${user.disabled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{user.name}</p>
                              {user.isEnvAdmin && <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-medium">Admin</span>}
                              {user.disabled && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Disabled</span>}
                            </div>
                            <p className="text-sm text-gray-500">{user.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">{new Date(user.createdAt).toLocaleDateString()}</span>
                          <button
                            onClick={() => {
                              setAdminPwUserId(adminPwUserId === user.id ? null : user.id);
                              setAdminNewPassword('');
                              setAdminConfirmPassword('');
                              setAdminPwError('');
                              setAdminPwMessage('');
                            }}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-sky-100 text-sky-700 hover:bg-sky-200 transition-colors"
                            title="Change password"
                          >
                            <KeyRound className="h-3 w-3" /> Password
                          </button>
                          {!user.isEnvAdmin && (
                            <button
                              onClick={() => handleToggleUser(user.id, user.disabled)}
                              disabled={togglingUserId === user.id}
                              className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                                user.disabled
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-red-100 text-red-600 hover:bg-red-200'
                              }`}
                              title={user.disabled ? 'Enable user' : 'Disable user'}
                            >
                              {togglingUserId === user.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : user.disabled ? (
                                <><ShieldCheck className="h-3 w-3" /> Enable</>
                              ) : (
                                <><ShieldOff className="h-3 w-3" /> Disable</>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      {adminPwUserId === user.id && (
                        <div className="mt-3 p-3 bg-white border border-sky-200 rounded-lg">
                          <p className="text-xs font-medium text-sky-700 mb-2">Set new password for {user.name}</p>
                          {adminPwError && <p className="text-xs text-red-600 mb-2">{adminPwError}</p>}
                          {adminPwMessage && <p className="text-xs text-green-600 mb-2">{adminPwMessage}</p>}
                          <div className="flex gap-2 items-end">
                            <div className="flex-1 space-y-1">
                              <Input
                                type="password"
                                placeholder="New password"
                                value={adminNewPassword}
                                onChange={(e) => setAdminNewPassword(e.target.value)}
                                className="h-8 text-sm"
                                minLength={6}
                              />
                            </div>
                            <div className="flex-1 space-y-1">
                              <Input
                                type="password"
                                placeholder="Confirm password"
                                value={adminConfirmPassword}
                                onChange={(e) => setAdminConfirmPassword(e.target.value)}
                                className="h-8 text-sm"
                                minLength={6}
                              />
                            </div>
                            <button
                              onClick={() => handleAdminChangePassword(user.id)}
                              disabled={isAdminChangingPw || !adminNewPassword}
                              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 transition-colors h-8"
                            >
                              {isAdminChangingPw ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                              Set
                            </button>
                            <button
                              onClick={() => setAdminPwUserId(null)}
                              className="flex items-center text-xs px-2 py-1.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors h-8"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </motion.div>
      </div>
    </div>
  );
}
