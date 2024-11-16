'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Send, Menu, ImageIcon, Video, Smile, Paperclip, Search, User } from 'lucide-react'
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { io, Socket } from 'socket.io-client'
import CryptoJS from 'crypto-js'

type MessageType = 'text' | 'image' | 'video' | 'file'

type Message = {
  id: string
  content: string
  type: MessageType
  createdAt: string
  status: 'sent' | 'delivered' | 'read'
  userId: string
  user: {
    name: string
    image: string
  }
}

type Room = {
  id: string
  name: string
  users: {
    id: string
    name: string
    image: string
  }[]
}

type UserProfile = {
  id: string
  name: string
  image: string
  status: string
  bio: string
}

export function EnhancedChatAppComponent() {
  const { data: session } = useSession()
  const [rooms, setRooms] = useState<Room[]>([])
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const encryptMessage = (message: string) => {
    const secretKey = process.env.NEXT_PUBLIC_ENCRYPTION_KEY || 'default-secret-key'
    return CryptoJS.AES.encrypt(message, secretKey).toString()
  }

  const decryptMessage = (ciphertext: string) => {
    const secretKey = process.env.NEXT_PUBLIC_ENCRYPTION_KEY || 'default-secret-key'
    const bytes = CryptoJS.AES.decrypt(ciphertext, secretKey)
    return bytes.toString(CryptoJS.enc.Utf8)
  }

  useEffect(() => {
    if (session?.user?.id) {
      socketRef.current = io('http://localhost:3001', {
        auth: { userId: session.user.id }
      })

      socketRef.current.on('initial messages', ({ roomId, messages: initialMessages }) => {
        if (selectedRoom?.id === roomId) {
          setMessages(initialMessages.map((msg: Message) => ({
            ...msg,
            content: decryptMessage(msg.content)
          })))
        }
      })

      socketRef.current.on('chat message', (msg: Message) => {
        if (selectedRoom?.id === msg.roomId) {
          setMessages(prevMessages => [...prevMessages, {
            ...msg,
            content: decryptMessage(msg.content)
          }])
        }
      })

      socketRef.current.on('user typing', ({ userId, isTyping }) => {
        if (userId !== session.user.id) {
          setIsTyping(isTyping)
        }
      })

      socketRef.current.on('message status updated', ({ messageId, status }) => {
        setMessages(prevMessages =>
          prevMessages.map(msg =>
            msg.id === messageId ? { ...msg, status } : msg
          )
        )
      })

      socketRef.current.on('room created', (room: Room) => {
        setRooms(prevRooms => [...prevRooms, room])
      })

      socketRef.current.on('user joined', ({ userId, roomId }) => {
        // Update room users
      })

      socketRef.current.on('user left', ({ userId, roomId }) => {
        // Update room users
      })

      // Fetch initial rooms
      fetch('/api/rooms')
        .then(res => res.json())
        .then(setRooms)

      // Fetch user profile
      fetch(`/api/users/${session.user.id}`)
        .then(res => res.json())
        .then(setUserProfile)

      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect()
        }
      }
    }
  }, [session, selectedRoom])

  const handleSendMessage = (type: MessageType, content: string) => {
    if (content.trim() !== '' && selectedRoom) {
      const encryptedContent = encryptMessage(content)
      socketRef.current?.emit('chat message', {
        roomId: selectedRoom.id,
        content: encryptedContent,
        type
      })
      setNewMessage('')
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        handleSendMessage(file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file', content)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleTyping = () => {
    if (selectedRoom) {
      socketRef.current?.emit('typing', { roomId: selectedRoom.id, isTyping: true })
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit('typing', { roomId: selectedRoom.id, isTyping: false })
      }, 2000)
    }
  }

  const createRoom = async (name: string, userIds: string[]) => {
    socketRef.current?.emit('create room', { name, userIds })
  }

  const joinRoom = (roomId: string) => {
    socketRef.current?.emit('join room', { roomId })
  }

  const leaveRoom = (roomId: string) => {
    socketRef.current?.emit('leave room', { roomId })
  }

  const updateProfile = async (profile: Partial<UserProfile>) => {
    const response = await fetch(`/api/users/${session?.user?.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile)
    })
    if (response.ok) {
      const updatedProfile = await response.json()
      setUserProfile(updatedProfile)
    }
  }

  const filteredMessages = useCallback(() => {
    if (!searchQuery) return messages
    return messages.filter(msg => 
      msg.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      msg.user.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [messages, searchQuery])

  const renderMessage = (message: Message) => {
    switch (message.type) {
      case 'image':
        return <img src={message.content} alt="Sent image" className="max-w-xs rounded-lg" />
      case 'video':
        return <video src={message.content} controls className="max-w-xs rounded-lg" />
      case 'file':
        return <a href={message.content} download className="text-blue-500 underline">Download File</a>
      default:
        return <p>{message.content}</p>
    }
  }

  if (!session) {
    return <div>Please sign in to use the chat app.</div>
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className={`bg-white w-64 flex-shrink-0 border-r ${isSidebarOpen ? 'block' : 'hidden'} md:block`}>
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-semibold">Rooms</h2>
          <Button variant="ghost" size="icon" onClick={() => setIsProfileOpen(true)}>
            <User className="h-5 w-5" />
            <span className="sr-only">Open profile</span>
          </Button>
        </div>
        <ScrollArea className="h-[calc(100vh-5rem)]">
          {rooms.map((room) => (
            <div
              key={room.id}
              className={`flex items-center p-3 cursor-pointer hover:bg-gray-100 ${selectedRoom?.id === room.id ? 'bg-gray-200' : ''}`}
              onClick={() => {
                setSelectedRoom(room)
                setIsSidebarOpen(false)
              }}
            >
              <div className="font-medium">{room.name}</div>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="bg-white border-b p-4 flex items-center">
          <Button variant="ghost" size="icon" className="md:hidden mr-2" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <Menu className="h-6 w-6" />
            <span className="sr-only">Toggle sidebar</span>
          </Button>
          {selectedRoom ? (
            <h2 className="text-xl font-semibold">{selectedRoom.name}</h2>
          ) : (
            <h2 className="text-xl font-semibold">Select a room</h2>
          )}
          <div className="ml-auto flex items-center">
            <Input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mr-2"
            />
            <Button variant="ghost" size="icon">
              <Search className="h-5 w-5" />
              <span className="sr-only">Search</span>
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          {filteredMessages().map((message) => (
            <div
              key={message.id}
              className={`flex mb-4 ${message.userId === session.user.id ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`rounded-lg p-2 max-w-xs ${
                  message.userId === session.user.id ? 'bg-blue-500 text-white' : 'bg-gray-200'
                }`}
              >
                {renderMessage(message)}
                <p className={`text-xs mt-1 ${message.userId === session.user.id ? 'text-blue-100' : 'text-gray-500'}`}>
                  {new Date(message.createdAt).toLocaleTimeString()} - {message.status}
                </p>
              </div>
            </div>
          ))}
          {isTyping && <div className="text-sm text-gray-500">Someone is typing...</div>}
        </ScrollArea>

        {/* Message Input */}
        <div className="bg-white border-t p-4">
          <div className="flex items-center">
            <Input
              type="text"
              placeholder="Type a message..."
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value)
                handleTyping()
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleSendMessage('text', newMessage)
                }
              }}
              className="flex-1 mr-2"
            />
            <input
              type="file"
              onChange={handleFileUpload}
              className="hidden"
              ref={fileInputRef}
            />
            <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4" />
              <span className="sr-only">Upload file</span>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Smile className="h-4 w-4" />
                  <span className="sr-only">Choose emoji</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <Picker
                  data={data}
                  onEmojiSelect={(emoji: { native: string }) => {
                    setNewMessage(prev => prev + emoji.native)
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button onClick={() => handleSendMessage('text', newMessage)}>
              <Send className="h-4 w-4" />
              <span className="sr-only">Send message</span>
            </Button>
          </div>
        </div>
      </div>

      {/* User Profile Dialog */}
      <Dialog open={isProfileOpen} onOpenChange={setIsProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User Profile</DialogTitle>
          </DialogHeader>
          {userProfile && (
            <div className="space-y-4">
              <div className="flex items-center space-x-4">
                <Avatar>
                  <AvatarImage src={userProfile.image} alt={userProfile.name} />
                  <AvatarFallback>{userProfile.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-medium">{userProfile.name}</h3>
                  <p className="text-sm text-gray-500">{userProfile.status}</p>
                </div>
              </div>
              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={userProfile.bio}
                  onChange={(e) => updateProfile({ bio: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Input
                  id="status"
                  value={userProfile.status}
                  onChange={(e) => updateProfile({ status: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}